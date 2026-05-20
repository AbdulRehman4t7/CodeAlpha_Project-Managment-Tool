const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const UserSchema = new Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true
  },
  password: {
    type: String,
    required: true
  },
  avatar: {
    type: String,
    default: ''
  },
  projects: [{
    type: Schema.Types.ObjectId,
    ref: 'Project'
  }],
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Pre-save to auto-generate avatar URL if empty using UI Avatars API
UserSchema.pre('save', function(next) {
  if (!this.avatar) {
    const formattedName = encodeURIComponent(this.name);
    this.avatar = `https://ui-avatars.com/api/?name=${formattedName}&background=8b5cf6&color=fff&bold=true`;
  }
  next();
});

module.exports = mongoose.model('User', UserSchema);
