const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const Comment = require('../models/Comment');
const Task = require('../models/Task');
const Project = require('../models/Project');
const Notification = require('../models/Notification');

// Helper to push notification
async function createAndSendNotification(io, recipientId, message, type, link) {
  try {
    const notification = new Notification({
      recipient: recipientId,
      message,
      type,
      link
    });
    await notification.save();

    if (io) {
      io.to(`user:${recipientId}`).emit('notification:new', {
        _id: notification._id,
        message,
        type,
        link,
        read: false,
        createdAt: notification.createdAt
      });
    }
  } catch (err) {
    console.error('Error creating notification:', err);
  }
}

// @route   POST api/comments
// @desc    Add comment to a task
// @access  Private
router.post('/', auth, async (req, res) => {
  const { taskId, text } = req.body;

  if (!taskId || !text) {
    return res.status(400).json({ msg: 'Task ID and text are required' });
  }

  try {
    const task = await Task.findById(taskId);
    if (!task) {
      return res.status(404).json({ msg: 'Task not found' });
    }

    const project = await Project.findById(task.project);
    const isMember = project.members.some(memberId => memberId.toString() === req.user.id) || project.owner.toString() === req.user.id;
    if (!isMember) {
      return res.status(403).json({ msg: 'Access denied' });
    }

    const newComment = new Comment({
      task: taskId,
      author: req.user.id,
      text
    });

    const comment = await newComment.save();

    // Link comment in Task model
    task.comments.push(comment._id);
    await task.save();

    const populatedComment = await Comment.findById(comment._id)
      .populate('author', 'name email avatar');

    const io = req.app.get('io');
    if (io) {
      // Broadcast comment:added to project room
      io.to(`project:${task.project}`).emit('comment:added', {
        taskId,
        comment: populatedComment
      });

      // Send a notification to other assignees in the task
      if (task.assignees && task.assignees.length > 0) {
        task.assignees.forEach(async (assigneeId) => {
          if (assigneeId.toString() !== req.user.id) {
            const commentMessage = `${req.user.name} commented on "${task.title}": "${text.substring(0, 30)}${text.length > 30 ? '...' : ''}"`;
            await createAndSendNotification(
              io,
              assigneeId.toString(),
              commentMessage,
              'comment_added',
              `#project-${task.project}-task-${task._id}`
            );
          }
        });
      }
    }

    res.json(populatedComment);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
});

// @route   GET api/comments/task/:taskId
// @desc    Get comments for a task
// @access  Private
router.get('/task/:taskId', auth, async (req, res) => {
  try {
    const task = await Task.findById(req.params.taskId);
    if (!task) {
      return res.status(404).json({ msg: 'Task not found' });
    }

    const project = await Project.findById(task.project);
    const isMember = project.members.some(memberId => memberId.toString() === req.user.id) || project.owner.toString() === req.user.id;
    if (!isMember) {
      return res.status(403).json({ msg: 'Access denied' });
    }

    const comments = await Comment.find({ task: req.params.taskId })
      .populate('author', 'name email avatar')
      .sort({ createdAt: 1 });

    res.json(comments);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
});

// @route   DELETE api/comments/:id
// @desc    Delete own comment
// @access  Private
router.delete('/:id', auth, async (req, res) => {
  try {
    const comment = await Comment.findById(req.params.id);
    if (!comment) {
      return res.status(404).json({ msg: 'Comment not found' });
    }

    // Verify authorship
    if (comment.author.toString() !== req.user.id) {
      return res.status(403).json({ msg: 'Access denied: Cannot delete other users comments' });
    }

    const task = await Task.findById(comment.task);
    if (task) {
      task.comments = task.comments.filter(id => id.toString() !== comment._id.toString());
      await task.save();
    }

    await Comment.findByIdAndDelete(req.params.id);

    const io = req.app.get('io');
    if (io && task) {
      io.to(`project:${task.project}`).emit('comment:deleted', {
        taskId: task._id,
        commentId: req.params.id
      });
    }

    res.json({ msg: 'Comment deleted' });
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
});

module.exports = router;
