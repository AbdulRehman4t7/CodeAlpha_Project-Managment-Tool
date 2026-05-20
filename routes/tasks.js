const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const auth = require('../middleware/auth');
const Task = require('../models/Task');
const Project = require('../models/Project');
const Notification = require('../models/Notification');
const Comment = require('../models/Comment');

// Ensure upload directory exists
const uploadDir = path.join(__dirname, '../public/uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Multer Storage Configuration
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + '-' + file.originalname);
  }
});
const upload = multer({ storage: storage });

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

// @route   POST api/tasks
// @desc    Create a task inside a project
// @access  Private
router.post('/', auth, async (req, res) => {
  const { title, description, project: projectId, status, priority, assignees, dueDate } = req.body;

  if (!title || !projectId) {
    return res.status(400).json({ msg: 'Title and Project ID are required' });
  }

  try {
    const project = await Project.findById(projectId);
    if (!project) {
      return res.status(404).json({ msg: 'Project not found' });
    }

    // Verify membership
    const isMember = project.members.some(memberId => memberId.toString() === req.user.id) || project.owner.toString() === req.user.id;
    if (!isMember) {
      return res.status(403).json({ msg: 'Access denied' });
    }

    const newTask = new Task({
      project: projectId,
      title,
      description: description || '',
      status: status || 'todo',
      priority: priority || 'medium',
      assignees: assignees || [],
      dueDate: dueDate ? new Date(dueDate) : null
    });

    const task = await newTask.save();
    const populatedTask = await Task.findById(task._id).populate('assignees', 'name email avatar');

    const io = req.app.get('io');
    if (io) {
      // Emit to all project members
      io.to(`project:${projectId}`).emit('task:created', populatedTask);
    }

    // Notify newly assigned members (excluding self)
    if (assignees && assignees.length > 0) {
      assignees.forEach(async (assigneeId) => {
        if (assigneeId !== req.user.id) {
          const assignMessage = `${req.user.name} assigned you the task "${title}" in "${project.name}"`;
          await createAndSendNotification(
            io,
            assigneeId,
            assignMessage,
            'task_assigned',
            `#project-${projectId}-task-${task._id}`
          );
        }
      });
    }

    res.json(populatedTask);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
});

// @route   GET api/tasks/project/:projectId
// @desc    Get all tasks for a project
// @access  Private
router.get('/project/:projectId', auth, async (req, res) => {
  try {
    const project = await Project.findById(req.params.projectId);
    if (!project) {
      return res.status(404).json({ msg: 'Project not found' });
    }

    const isMember = project.members.some(memberId => memberId.toString() === req.user.id) || project.owner.toString() === req.user.id;
    if (!isMember) {
      return res.status(403).json({ msg: 'Access denied' });
    }

    const tasks = await Task.find({ project: req.params.projectId })
      .populate('assignees', 'name email avatar')
      .populate({
        path: 'comments',
        populate: { path: 'author', select: 'name email avatar' }
      })
      .sort({ createdAt: 1 });

    res.json(tasks);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
});

// @route   GET api/tasks/:id
// @desc    Get detailed task by ID
// @access  Private
router.get('/:id', auth, async (req, res) => {
  try {
    const task = await Task.findById(req.params.id)
      .populate('assignees', 'name email avatar')
      .populate({
        path: 'comments',
        populate: { path: 'author', select: 'name email avatar' }
      });

    if (!task) {
      return res.status(404).json({ msg: 'Task not found' });
    }

    // Verify project access
    const project = await Project.findById(task.project);
    if (!project) {
      return res.status(404).json({ msg: 'Associated project not found' });
    }

    const isMember = project.members.some(memberId => memberId.toString() === req.user.id) || project.owner.toString() === req.user.id;
    if (!isMember) {
      return res.status(403).json({ msg: 'Access denied' });
    }

    res.json(task);
  } catch (err) {
    console.error(err.message);
    if (err.kind === 'ObjectId') {
      return res.status(404).json({ msg: 'Task not found' });
    }
    res.status(500).send('Server error');
  }
});

// @route   PUT api/tasks/:id
// @desc    Update task details
// @access  Private
router.put('/:id', auth, async (req, res) => {
  const { title, description, status, priority, assignees, dueDate } = req.body;

  try {
    let task = await Task.findById(req.params.id);
    if (!task) {
      return res.status(404).json({ msg: 'Task not found' });
    }

    const project = await Project.findById(task.project);
    const isMember = project.members.some(memberId => memberId.toString() === req.user.id) || project.owner.toString() === req.user.id;
    if (!isMember) {
      return res.status(403).json({ msg: 'Access denied' });
    }

    // Capture original assignees to detect new assignments
    const oldAssignees = task.assignees.map(id => id.toString());

    // Update fields
    task.title = title || task.title;
    task.description = description !== undefined ? description : task.description;
    task.status = status || task.status;
    task.priority = priority || task.priority;
    task.assignees = assignees || task.assignees;
    task.dueDate = dueDate !== undefined ? (dueDate ? new Date(dueDate) : null) : task.dueDate;

    await task.save();

    const populatedTask = await Task.findById(task._id)
      .populate('assignees', 'name email avatar')
      .populate({
        path: 'comments',
        populate: { path: 'author', select: 'name email avatar' }
      });

    const io = req.app.get('io');
    if (io) {
      io.to(`project:${task.project}`).emit('task:updated', populatedTask);
    }

    // Send notifications to newly added assignees
    if (assignees) {
      const newAssignees = assignees.filter(id => !oldAssignees.includes(id));
      newAssignees.forEach(async (assigneeId) => {
        if (assigneeId !== req.user.id) {
          const assignMessage = `${req.user.name} assigned you the task "${task.title}" in "${project.name}"`;
          await createAndSendNotification(
            io,
            assigneeId,
            assignMessage,
            'task_assigned',
            `#project-${task.project}-task-${task._id}`
          );
        }
      });
    }

    res.json(populatedTask);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
});

// @route   PATCH api/tasks/:id/move
// @desc    Move task to another status (column drop)
// @access  Private
router.patch('/:id/move', auth, async (req, res) => {
  const { status } = req.body;

  if (!status || !['todo', 'inprogress', 'review', 'done'].includes(status)) {
    return res.status(400).json({ msg: 'Valid status is required' });
  }

  try {
    let task = await Task.findById(req.params.id);
    if (!task) {
      return res.status(404).json({ msg: 'Task not found' });
    }

    const project = await Project.findById(task.project);
    const isMember = project.members.some(memberId => memberId.toString() === req.user.id) || project.owner.toString() === req.user.id;
    if (!isMember) {
      return res.status(403).json({ msg: 'Access denied' });
    }

    const oldStatus = task.status;
    task.status = status;
    await task.save();

    const populatedTask = await Task.findById(task._id).populate('assignees', 'name email avatar');

    const io = req.app.get('io');
    if (io) {
      io.to(`project:${task.project}`).emit('task:moved', {
        taskId: task._id,
        projectId: task.project,
        oldStatus,
        newStatus: status,
        task: populatedTask
      });

      // Send real-time updates to assignees if status changed
      if (task.assignees.length > 0) {
        task.assignees.forEach(async (assigneeId) => {
          if (assigneeId.toString() !== req.user.id) {
            const moveMessage = `${req.user.name} moved "${task.title}" to ${status.toUpperCase()} in "${project.name}"`;
            await createAndSendNotification(
              io,
              assigneeId.toString(),
              moveMessage,
              'task_moved',
              `#project-${task.project}-task-${task._id}`
            );
          }
        });
      }
    }

    res.json(populatedTask);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
});

// @route   DELETE api/tasks/:id
// @desc    Delete a task
// @access  Private
router.delete('/:id', auth, async (req, res) => {
  try {
    const task = await Task.findById(req.params.id);
    if (!task) {
      return res.status(404).json({ msg: 'Task not found' });
    }

    const project = await Project.findById(task.project);
    const isMember = project.members.some(memberId => memberId.toString() === req.user.id) || project.owner.toString() === req.user.id;
    if (!isMember) {
      return res.status(403).json({ msg: 'Access denied' });
    }

    // Delete comments associated with this task
    await Comment.deleteMany({ task: task._id });

    const projectId = task.project;
    const taskId = task._id;

    await Task.findByIdAndDelete(req.params.id);

    const io = req.app.get('io');
    if (io) {
      io.to(`project:${projectId}`).emit('task:deleted', { taskId, projectId });
    }

    res.json({ msg: 'Task deleted successfully' });
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
});

// @route   POST api/tasks/:id/attach
// @desc    Upload file attachment for a task
// @access  Private
router.post('/:id/attach', [auth, upload.single('attachment')], async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ msg: 'No file uploaded' });
    }

    let task = await Task.findById(req.params.id);
    if (!task) {
      return res.status(404).json({ msg: 'Task not found' });
    }

    const project = await Project.findById(task.project);
    const isMember = project.members.some(memberId => memberId.toString() === req.user.id) || project.owner.toString() === req.user.id;
    if (!isMember) {
      return res.status(403).json({ msg: 'Access denied' });
    }

    const relativeUrl = `/uploads/${req.file.filename}`;
    const newAttachment = {
      name: req.file.originalname,
      url: relativeUrl,
      uploadedAt: new Date()
    };

    task.attachments.push(newAttachment);
    await task.save();

    const populatedTask = await Task.findById(task._id)
      .populate('assignees', 'name email avatar')
      .populate({
        path: 'comments',
        populate: { path: 'author', select: 'name email avatar' }
      });

    const io = req.app.get('io');
    if (io) {
      io.to(`project:${task.project}`).emit('task:updated', populatedTask);
    }

    res.json(populatedTask);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
});

module.exports = router;
