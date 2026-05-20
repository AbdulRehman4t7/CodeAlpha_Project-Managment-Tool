const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const Project = require('../models/Project');
const User = require('../models/User');
const Task = require('../models/Task');
const Notification = require('../models/Notification');

// Helper to push real-time notification
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

// @route   GET api/projects
// @desc    Get all projects for logged in user
// @access  Private
router.get('/', auth, async (req, res) => {
  try {
    const projects = await Project.find({
      $or: [{ owner: req.user.id }, { members: req.user.id }]
    })
    .populate('owner', 'name email avatar')
    .populate('members', 'name email avatar')
    .sort({ createdAt: -1 });

    // Dynamically calculate task completion metrics
    const enrichedProjects = [];
    for (let project of projects) {
      const totalTasks = await Task.countDocuments({ project: project._id });
      const completedTasks = await Task.countDocuments({ project: project._id, status: 'done' });
      
      const projObj = project.toObject();
      projObj.totalTasks = totalTasks;
      projObj.completedTasks = completedTasks;
      enrichedProjects.push(projObj);
    }

    res.json(enrichedProjects);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
});

// @route   POST api/projects
// @desc    Create a project
// @access  Private
router.post('/', auth, async (req, res) => {
  const { name, description } = req.body;

  if (!name) {
    return res.status(400).json({ msg: 'Project name is required' });
  }

  try {
    const newProject = new Project({
      name,
      description,
      owner: req.user.id,
      members: [req.user.id] // Owner is also a member
    });

    const project = await newProject.save();

    // Add project reference to user's projects array
    await User.findByIdAndUpdate(req.user.id, {
      $push: { projects: project._id }
    });

    const populatedProject = await Project.findById(project._id)
      .populate('owner', 'name email avatar')
      .populate('members', 'name email avatar');

    res.json(populatedProject);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
});

// @route   GET api/projects/:id
// @desc    Get single project details (including members)
// @access  Private
router.get('/:id', auth, async (req, res) => {
  try {
    const project = await Project.findById(req.id || req.params.id)
      .populate('owner', 'name email avatar')
      .populate('members', 'name email avatar');

    if (!project) {
      return res.status(404).json({ msg: 'Project not found' });
    }

    // Verify membership
    const isMember = project.members.some(member => member._id.toString() === req.user.id) || project.owner._id.toString() === req.user.id;
    if (!isMember) {
      return res.status(403).json({ msg: 'Access denied: Not a member of this project' });
    }

    res.json(project);
  } catch (err) {
    console.error(err.message);
    if (err.kind === 'ObjectId') {
      return res.status(404).json({ msg: 'Project not found' });
    }
    res.status(500).send('Server error');
  }
});

// @route   PUT api/projects/:id
// @desc    Update project info
// @access  Private
router.put('/:id', auth, async (req, res) => {
  const { name, description } = req.body;

  try {
    let project = await Project.findById(req.params.id);

    if (!project) {
      return res.status(404).json({ msg: 'Project not found' });
    }

    // Verify project ownership or manager status
    if (project.owner.toString() !== req.user.id) {
      return res.status(403).json({ msg: 'Access denied: Only project owner can update settings' });
    }

    project.name = name || project.name;
    project.description = description !== undefined ? description : project.description;

    await project.save();

    const populatedProject = await Project.findById(project._id)
      .populate('owner', 'name email avatar')
      .populate('members', 'name email avatar');

    // Notify project members about updates via socket
    const io = req.app.get('io');
    if (io) {
      io.to(`project:${project._id}`).emit('project:updated', populatedProject);
    }

    res.json(populatedProject);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
});

// @route   DELETE api/projects/:id
// @desc    Delete project (and its related tasks, comments)
// @access  Private
router.delete('/:id', auth, async (req, res) => {
  try {
    const project = await Project.findById(req.params.id);

    if (!project) {
      return res.status(404).json({ msg: 'Project not found' });
    }

    // Verify ownership
    if (project.owner.toString() !== req.user.id) {
      return res.status(403).json({ msg: 'Access denied: Only project owner can delete project' });
    }

    const memberIds = project.members;

    // Delete all tasks in the project
    await Task.deleteMany({ project: project._id });

    // Remove project from users projects arrays
    await User.updateMany(
      { _id: { $in: memberIds } },
      { $pull: { projects: project._id } }
    );

    await Project.findByIdAndDelete(req.params.id);

    // Notify members via socket
    const io = req.app.get('io');
    if (io) {
      io.to(`project:${project._id}`).emit('project:deleted', { projectId: req.params.id });
    }

    res.json({ msg: 'Project deleted successfully' });
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
});

// @route   POST api/projects/:id/invite
// @desc    Invite member to project by email
// @access  Private
router.post('/:id/invite', auth, async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ msg: 'Email is required to invite member' });
  }

  try {
    const project = await Project.findById(req.params.id);

    if (!project) {
      return res.status(404).json({ msg: 'Project not found' });
    }

    // Verify ownership or membership
    const isMember = project.members.some(memberId => memberId.toString() === req.user.id) || project.owner.toString() === req.user.id;
    if (!isMember) {
      return res.status(403).json({ msg: 'Access denied' });
    }

    // Find the invited user
    const invitedUser = await User.findOne({ email: email.toLowerCase().trim() });
    if (!invitedUser) {
      return res.status(404).json({ msg: `User with email ${email} not found` });
    }

    // Check if user is already a member
    const alreadyMember = project.members.some(memberId => memberId.toString() === invitedUser._id.toString());
    if (alreadyMember) {
      return res.status(400).json({ msg: 'User is already a member of this project' });
    }

    // Add to project members
    project.members.push(invitedUser._id);
    await project.save();

    // Add to user projects
    invitedUser.projects.push(project._id);
    await invitedUser.save();

    const populatedProject = await Project.findById(project._id)
      .populate('owner', 'name email avatar')
      .populate('members', 'name email avatar');

    const io = req.app.get('io');

    // Notify project members about membership changes
    if (io) {
      io.to(`project:${project._id}`).emit('project:updated', populatedProject);
    }

    // Create real-time notification for the invited user
    const inviteMessage = `${req.user.name} invited you to join the project "${project.name}"`;
    await createAndSendNotification(
      io,
      invitedUser._id,
      inviteMessage,
      'project_invited',
      `#project-${project._id}`
    );

    res.json(populatedProject);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
});

// @route   DELETE api/projects/:id/members/:userId
// @desc    Remove member from project
// @access  Private
router.delete('/:id/members/:userId', auth, async (req, res) => {
  try {
    const project = await Project.findById(req.params.id);

    if (!project) {
      return res.status(404).json({ msg: 'Project not found' });
    }

    // Only owner can remove someone, or users can remove themselves (leave project)
    const isOwner = project.owner.toString() === req.user.id;
    const isSelf = req.params.userId === req.user.id;

    if (!isOwner && !isSelf) {
      return res.status(403).json({ msg: 'Access denied: Unauthorized to remove member' });
    }

    // Owner cannot be removed
    if (project.owner.toString() === req.params.userId) {
      return res.status(400).json({ msg: 'Owner cannot be removed from their own project' });
    }

    // Pull from project members array
    project.members = project.members.filter(memberId => memberId.toString() !== req.params.userId);
    await project.save();

    // Pull from user's projects array
    await User.findByIdAndUpdate(req.params.userId, {
      $pull: { projects: project._id }
    });

    // Remove user as assignee from all tasks within this project
    await Task.updateMany(
      { project: project._id },
      { $pull: { assignees: req.params.userId } }
    );

    const populatedProject = await Project.findById(project._id)
      .populate('owner', 'name email avatar')
      .populate('members', 'name email avatar');

    const io = req.app.get('io');
    if (io) {
      // Notify other members of member removal
      io.to(`project:${project._id}`).emit('project:updated', populatedProject);
      
      // Notify the removed member directly
      const removeMessage = isSelf
        ? `You left the project "${project.name}"`
        : `You have been removed from the project "${project.name}" by the owner`;
        
      await createAndSendNotification(
        io,
        req.params.userId,
        removeMessage,
        'project_invited', // general project update
        ''
      );

      // Force socket disconnect for that user from the project room
      io.to(`user:${req.params.userId}`).emit('project:removed', { projectId: project._id });
    }

    res.json(populatedProject);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
});

module.exports = router;
