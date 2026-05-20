/* ==========================================================================
   CODEALPHA REAL-TIME PROJECT MANAGEMENT TOOL - FRONTEND APP ENGINE
   ========================================================================== */

// --------------------------------------------------------------------------
// 1. Application State & Context Management
// --------------------------------------------------------------------------
const state = {
  token: localStorage.getItem('token') || null,
  user: null,
  projects: [],
  currentProjectId: null,
  currentProject: null,
  tasks: [],
  socket: null,
  notifications: [],
  activeTaskDetailId: null
};

const BASE_URL = window.location.origin;

// --------------------------------------------------------------------------
// 2. HTTP API Fetch Helper
// --------------------------------------------------------------------------
async function apiFetch(path, options = {}) {
  const url = `${BASE_URL}${path}`;
  
  const headers = {
    ...options.headers
  };

  // If token exists, auto-append Bearer header
  if (state.token) {
    headers['Authorization'] = `Bearer ${state.token}`;
  }

  // Auto-stringify body if it's an object and not FormData
  let body = options.body;
  if (body && typeof body === 'object' && !(body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(body);
  }

  const response = await fetch(url, {
    ...options,
    headers,
    body
  });

  const data = await response.json();

  if (!response.ok) {
    if (response.status === 401) {
      // Auto logout on token expiration / invalid token
      localStorage.removeItem('token');
      state.token = null;
      state.user = null;
      if (state.socket) {
        try {
          state.socket.disconnect();
        } catch (e) {}
        state.socket = null;
      }
      window.location.hash = '#login';
      showToast('Session expired or token is invalid. Please login again.', 'error');
    }
    throw new Error(data.msg || data.error || 'API execution failed');
  }

  return data;
}


// --------------------------------------------------------------------------
// 3. SPA Routing & View Control (Hash Based Router)
// --------------------------------------------------------------------------
const views = {
  auth: document.getElementById('view-auth'),
  app: document.getElementById('view-app')
};

const panels = {
  dashboard: document.getElementById('panel-dashboard'),
  board: document.getElementById('panel-board'),
  settings: document.getElementById('panel-settings'),
  profile: document.getElementById('panel-profile')
};

function switchView(viewName) {
  Object.keys(views).forEach(key => {
    views[key].classList.remove('active-view');
  });
  views[viewName].classList.add('active-view');
}

function switchPanel(panelName) {
  Object.keys(panels).forEach(key => {
    panels[key].classList.remove('active-panel');
  });
  panels[panelName].classList.add('active-panel');
  
  // Highlight active sidebar nav item
  document.querySelectorAll('.sidebar-nav .nav-item, .sidebar-projects-list .sidebar-project-link').forEach(item => {
    item.classList.remove('active');
  });

  // Clear specific board joining highlights
  if (panelName === 'dashboard') {
    document.getElementById('nav-dashboard').classList.add('active');
    document.getElementById('page-title').innerText = 'Dashboard';
    leaveCurrentProjectRoom();
    state.currentProjectId = null;
    state.currentProject = null;
  } else if (panelName === 'profile') {
    document.getElementById('nav-profile').classList.add('active');
    document.getElementById('page-title').innerText = 'User Profile';
    leaveCurrentProjectRoom();
    state.currentProjectId = null;
    state.currentProject = null;
  } else if (panelName === 'settings') {
    document.getElementById('page-title').innerText = 'Project Settings';
  } else if (panelName === 'board') {
    document.getElementById('page-title').innerText = 'Kanban Board';
  }
}

async function handleRouter() {
  const hash = window.location.hash || '#dashboard';

  // Auth Protection guard
  if (!state.token) {
    switchView('auth');
    window.location.hash = '#login';
    return;
  }

  switchView('app');

  // Dashboard route
  if (hash === '#dashboard') {
    switchPanel('dashboard');
    await loadUserDashboard();
  }
  // User profile route
  else if (hash === '#profile') {
    switchPanel('profile');
    await loadUserProfile();
  }
  // Project detail board route
  else if (hash.startsWith('#project-')) {
    const parts = hash.split('-');
    const projectId = parts[1];
    
    // Check if task detail path is specified inside route: #project-{projectId}-task-{taskId}
    let taskId = null;
    if (parts.length > 2 && parts[2] === 'task') {
      taskId = parts[3];
    }

    state.currentProjectId = projectId;
    switchPanel('board');
    await loadProjectBoard(projectId);

    if (taskId) {
      openTaskDetail(taskId);
    }
  } 
  // Login / Register route fallback
  else if (hash === '#login' || hash === '#register') {
    if (state.token) {
      window.location.hash = '#dashboard';
    } else {
      switchView('auth');
    }
  }
}

// --------------------------------------------------------------------------
// 4. Socket.io Collaborative Client Core
// --------------------------------------------------------------------------
function initSocketConnection() {
  if (state.socket) {
    state.socket.disconnect();
  }

  // Connect to server and pass current token inside handshake query
  state.socket = io({
    query: { token: state.token }
  });

  // Listen: Direct notifications
  state.socket.on('notification:new', (notification) => {
    state.notifications.unshift(notification);
    renderNotificationsList();
    showToast(notification.message, 'info');
  });

  // Listen: Dynamic tasks operations within active board
  state.socket.on('task:created', (task) => {
    if (state.currentProjectId === task.project) {
      state.tasks.push(task);
      renderKanbanBoard();
      showToast(`New task created: "${task.title}"`, 'success');
    }
  });

  state.socket.on('task:updated', (task) => {
    if (state.currentProjectId === task.project) {
      state.tasks = state.tasks.map(t => t._id === task._id ? task : t);
      renderKanbanBoard();
      
      // Update details modal dynamically if currently viewing it
      if (state.activeTaskDetailId === task._id) {
        populateTaskDetailModal(task);
      }
    }
  });

  state.socket.on('task:moved', (data) => {
    const { taskId, projectId, oldStatus, newStatus, task } = data;
    if (state.currentProjectId === projectId) {
      state.tasks = state.tasks.map(t => t._id === taskId ? task : t);
      renderKanbanBoard();
      
      // Animate movement visually
      const card = document.querySelector(`.task-card[data-id="${taskId}"]`);
      if (card) {
        card.style.transform = 'scale(1.05)';
        setTimeout(() => {
          card.style.transform = '';
        }, 300);
      }
    }
  });

  state.socket.on('task:deleted', (data) => {
    const { taskId, projectId } = data;
    if (state.currentProjectId === projectId) {
      state.tasks = state.tasks.filter(t => t._id !== taskId);
      renderKanbanBoard();
      if (state.activeTaskDetailId === taskId) {
        closeModal('modal-task-detail');
      }
      showToast('A task was deleted by another user.', 'info');
    }
  });

  state.socket.on('comment:added', (data) => {
    const { taskId, comment } = data;
    if (state.activeTaskDetailId === taskId) {
      // Append comment to the list
      const stream = document.getElementById('detail-comments-stream');
      const card = createCommentCardDOM(comment);
      stream.appendChild(card);
      stream.scrollTop = stream.scrollHeight;
    }
    // Update count in tasks list array too
    const task = state.tasks.find(t => t._id === taskId);
    if (task) {
      if (!task.comments.some(c => c._id === comment._id)) {
        task.comments.push(comment);
        renderKanbanBoard();
      }
    }
  });

  state.socket.on('comment:deleted', (data) => {
    const { taskId, commentId } = data;
    if (state.activeTaskDetailId === taskId) {
      const row = document.querySelector(`.comment-card[data-id="${commentId}"]`);
      if (row) row.remove();
    }
    const task = state.tasks.find(t => t._id === taskId);
    if (task) {
      task.comments = task.comments.filter(c => c._id !== commentId);
      renderKanbanBoard();
    }
  });

  state.socket.on('project:updated', (project) => {
    if (state.currentProjectId === project._id) {
      state.currentProject = project;
      document.getElementById('board-project-name').innerText = project.name;
      document.getElementById('board-project-desc').innerText = project.description;
      renderProjectMembers(project);
    }
    // Update sidebars list
    state.projects = state.projects.map(p => p._id === project._id ? project : p);
    renderSidebarProjects();
  });

  state.socket.on('project:deleted', (data) => {
    if (state.currentProjectId === data.projectId) {
      showToast('This project has been permanently deleted by the owner.', 'error');
      window.location.hash = '#dashboard';
    }
    state.projects = state.projects.filter(p => p._id !== data.projectId);
    renderSidebarProjects();
  });

  state.socket.on('project:removed', (data) => {
    if (state.currentProjectId === data.projectId) {
      showToast('You have been removed from this project.', 'error');
      window.location.hash = '#dashboard';
    }
    state.projects = state.projects.filter(p => p._id !== data.projectId);
    renderSidebarProjects();
  });
}

function joinProjectRoom(projectId) {
  if (state.socket) {
    state.socket.emit('join:project', { projectId });
  }
}

function leaveCurrentProjectRoom() {
  if (state.socket && state.currentProjectId) {
    state.socket.emit('leave:project', { projectId: state.currentProjectId });
  }
}

// --------------------------------------------------------------------------
// 5. Auth / Registration Actions
// --------------------------------------------------------------------------
document.getElementById('form-login').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('login-email').value;
  const password = document.getElementById('login-password').value;

  try {
    const data = await apiFetch('/api/auth/login', {
      method: 'POST',
      body: { email, password }
    });

    state.token = data.token;
    state.user = data.user;
    localStorage.setItem('token', data.token);

    initSocketConnection();
    showToast('Signed in successfully! Welcome back.', 'success');
    window.location.hash = '#dashboard';
  } catch (err) {
    showToast(err.message, 'error');
  }
});

document.getElementById('form-register').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('register-name').value;
  const email = document.getElementById('register-email').value;
  const password = document.getElementById('register-password').value;

  try {
    const data = await apiFetch('/api/auth/register', {
      method: 'POST',
      body: { name, email, password }
    });

    state.token = data.token;
    state.user = data.user;
    localStorage.setItem('token', data.token);

    initSocketConnection();
    showToast('Account created successfully! Welcome onboard.', 'success');
    window.location.hash = '#dashboard';
  } catch (err) {
    showToast(err.message, 'error');
  }
});

document.getElementById('btn-logout').addEventListener('click', () => {
  leaveCurrentProjectRoom();
  if (state.socket) {
    state.socket.disconnect();
    state.socket = null;
  }
  state.token = null;
  state.user = null;
  localStorage.removeItem('token');
  showToast('Signed out successfully.', 'info');
  window.location.hash = '#login';
});

// Toggle forms
document.getElementById('btn-toggle-register').addEventListener('click', () => {
  document.getElementById('form-login').classList.remove('active-form');
  document.getElementById('form-register').classList.add('active-form');
  document.getElementById('auth-subtitle').innerText = 'Begin your collaborative journey today';
});

document.getElementById('btn-toggle-login').addEventListener('click', () => {
  document.getElementById('form-register').classList.remove('active-form');
  document.getElementById('form-login').classList.add('active-form');
  document.getElementById('auth-subtitle').innerText = 'Elevate your team collaboration experience';
});

// --------------------------------------------------------------------------
// 6. User Profile Views Loader
// --------------------------------------------------------------------------
async function loadUserProfile() {
  try {
    const user = await apiFetch('/api/auth/me');
    state.user = user;

    document.getElementById('profile-username').innerText = user.name;
    document.getElementById('profile-email').innerText = user.email;
    document.getElementById('profile-avatar-img').src = user.avatar;
    document.getElementById('profile-joined-date').innerText = formatDate(user.createdAt);

    // Profile statistics
    document.getElementById('profile-stats-projects').innerText = user.projects.length;

    // Load active assigned tasks
    const listContainer = document.getElementById('profile-tasks-list');
    listContainer.innerHTML = '';

    let assignedTasksCount = 0;
    
    // Fetch all user projects to scan assigned tasks
    const projects = await apiFetch('/api/projects');
    for (const proj of projects) {
      const tasks = await apiFetch(`/api/tasks/project/${proj._id}`);
      const userAssigned = tasks.filter(t => t.assignees.some(a => a._id === user._id));
      assignedTasksCount += userAssigned.length;

      userAssigned.forEach(task => {
        const item = document.createElement('div');
        item.className = 'profile-task-item';
        item.innerHTML = `
          <div>
            <div class="profile-task-title">${task.title}</div>
            <div class="profile-task-project"><i class="fa-solid fa-layer-group"></i> ${proj.name}</div>
          </div>
          <span class="priority-badge ${task.priority}">${task.priority}</span>
        `;
        item.addEventListener('click', () => {
          window.location.hash = `#project-${proj._id}-task-${task._id}`;
        });
        listContainer.appendChild(item);
      });
    }

    document.getElementById('profile-stats-tasks').innerText = assignedTasksCount;

    if (assignedTasksCount === 0) {
      listContainer.innerHTML = '<div class="no-data-msg">No tasks assigned to you currently. Well done!</div>';
    }

  } catch (err) {
    showToast(err.message, 'error');
  }
}

// --------------------------------------------------------------------------
// 7. Workspace & Dashboard Functions
// --------------------------------------------------------------------------
async function loadUserDashboard() {
  try {
    // 1. Load user metadata
    if (!state.user) {
      state.user = await apiFetch('/api/auth/me');
    }
    
    document.getElementById('hero-user-name').innerText = state.user.name;
    document.getElementById('user-name-sidebar').innerText = state.user.name;
    document.getElementById('user-email-sidebar').innerText = state.user.email;
    document.getElementById('user-avatar-sidebar').src = state.user.avatar;

    // 2. Fetch projects list
    state.projects = await apiFetch('/api/projects');
    renderSidebarProjects();
    renderDashboardProjects();

    // 3. Fetch notifications
    await loadNotifications();

  } catch (err) {
    showToast(err.message, 'error');
  }
}

function renderSidebarProjects() {
  const container = document.getElementById('sidebar-projects-list');
  container.innerHTML = '';

  state.projects.forEach(project => {
    const link = document.createElement('a');
    link.className = 'sidebar-project-link';
    link.href = `#project-${project._id}`;
    link.id = `sidebar-link-${project._id}`;
    link.innerHTML = `
      <span><span class="bullet"></span>${project.name}</span>
      <i class="fa-solid fa-chevron-right" style="font-size:0.75rem; opacity:0.4;"></i>
    `;
    container.appendChild(link);
  });
}

function renderDashboardProjects() {
  const grid = document.getElementById('projects-grid');
  grid.innerHTML = '';

  state.projects.forEach(project => {
    const isOwner = project.owner._id === state.user._id;

    // Avatar list html
    let avatarsHtml = '';
    project.members.slice(0, 4).forEach(member => {
      avatarsHtml += `<img src="${member.avatar}" title="${member.name}" class="member-circle" alt="${member.name}">`;
    });
    if (project.members.length > 4) {
      avatarsHtml += `<div class="member-circle-more">+${project.members.length - 4}</div>`;
    }

    // Dynamic Workspace Progress Statistics
    const total = project.totalTasks || 0;
    const completed = project.completedTasks || 0;
    const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;

    const card = document.createElement('div');
    card.className = 'project-card glass';
    card.innerHTML = `
      <div class="project-card-header">
        <h4>${project.name}</h4>
        ${isOwner ? '<span class="project-owner-badge">Owner</span>' : ''}
      </div>
      <p class="project-card-desc">${project.description || 'No description provided.'}</p>
      
      <!-- Sleek Glowing Progress Bar -->
      <div class="project-progress-container" style="margin: 8px 0 16px 0;">
        <div style="display:flex; justify-content:space-between; font-size:0.72rem; color:var(--text-muted); margin-bottom:6px;">
          <span style="font-weight:500;">Workspace Progress</span>
          <span style="font-weight:700; color:var(--accent-primary);">${percentage}% (${completed}/${total} Tasks)</span>
        </div>
        <div class="progress-bar-bg" style="width:100%; height:5px; background:rgba(255,255,255,0.05); border-radius:3px; overflow:hidden;">
          <div class="progress-bar-fill" style="width:${percentage}%; height:100%; background:var(--accent-gradient); border-radius:3px; box-shadow:0 0 6px var(--accent-primary); transition:width 0.4s cubic-bezier(0.4, 0, 0.2, 1);"></div>
        </div>
      </div>

      <div class="project-card-footer">
        <div class="members-overlap">
          ${avatarsHtml}
        </div>
        <span class="project-members-count">
          <i class="fa-solid fa-users"></i> ${project.members.length} members
        </span>
      </div>
    `;

    card.addEventListener('click', () => {
      window.location.hash = `#project-${project._id}`;
    });

    grid.appendChild(card);
  });

  // Create Project Helper Box Card
  const createCard = document.createElement('div');
  createCard.className = 'project-card glass create-placeholder-card';
  createCard.style.borderStyle = 'dashed';
  createCard.style.justifyContent = 'center';
  createCard.style.alignItems = 'center';
  createCard.innerHTML = `
    <i class="fa-solid fa-folder-plus" style="font-size: 2.2rem; color: var(--accent-primary); margin-bottom: 12px;"></i>
    <span style="font-weight:700; color: #fff;">Establish New Project</span>
    <span style="font-size:0.75rem; color:var(--text-muted); margin-top:4px;">Deploy workspace for your team</span>
  `;
  createCard.addEventListener('click', () => {
    openModal('modal-create-project');
  });
  grid.appendChild(createCard);
}

// --------------------------------------------------------------------------
// 8. Dynamic Kanban Board Controller
// --------------------------------------------------------------------------
async function loadProjectBoard(projectId) {
  try {
    // 1. Fetch single project metadata
    state.currentProject = await apiFetch(`/api/projects/${projectId}`);
    
    // Highlight sidebar project link
    const sideLink = document.getElementById(`sidebar-link-${projectId}`);
    if (sideLink) sideLink.classList.add('active');

    // 2. Hydrate board header
    document.getElementById('board-project-name').innerText = state.currentProject.name;
    document.getElementById('board-project-desc').innerText = state.currentProject.description || 'No description provided.';
    
    renderProjectMembers(state.currentProject);

    // 3. Connect/Join project room dynamically
    joinProjectRoom(projectId);

    // 4. Fetch tasks
    state.tasks = await apiFetch(`/api/tasks/project/${projectId}`);
    renderKanbanBoard();

  } catch (err) {
    showToast(err.message, 'error');
    window.location.hash = '#dashboard';
  }
}

function renderProjectMembers(project) {
  const container = document.getElementById('board-members-list');
  container.innerHTML = '';

  project.members.slice(0, 5).forEach(member => {
    container.innerHTML += `<img src="${member.avatar}" title="${member.name} (${member.email})" class="member-circle" alt="${member.name}">`;
  });

  if (project.members.length > 5) {
    container.innerHTML += `<div class="member-circle-more">+${project.members.length - 5}</div>`;
  }
}

function renderKanbanBoard() {
  const columns = {
    todo: document.getElementById('column-todo'),
    inprogress: document.getElementById('column-inprogress'),
    review: document.getElementById('column-review'),
    done: document.getElementById('column-done')
  };

  const counts = {
    todo: document.getElementById('count-todo'),
    inprogress: document.getElementById('count-inprogress'),
    review: document.getElementById('count-review'),
    done: document.getElementById('count-done')
  };

  // Clear previous rendering
  Object.keys(columns).forEach(key => {
    columns[key].innerHTML = '';
  });

  const totals = { todo: 0, inprogress: 0, review: 0, done: 0 };

  // Fetch active values from filter inputs
  const searchInput = document.getElementById('board-search-input');
  const filterSelect = document.getElementById('board-filter-priority');
  const sortSelect = document.getElementById('board-sort-by');

  const query = searchInput ? searchInput.value.toLowerCase().trim() : '';
  const priorityFilter = filterSelect ? filterSelect.value : 'all';
  const sortBy = sortSelect ? sortSelect.value : 'none';

  // Apply filters in-memory
  let filteredTasks = [...state.tasks];

  if (query) {
    filteredTasks = filteredTasks.filter(t => 
      t.title.toLowerCase().includes(query) || 
      (t.description && t.description.toLowerCase().includes(query))
    );
  }

  if (priorityFilter !== 'all') {
    filteredTasks = filteredTasks.filter(t => t.priority === priorityFilter);
  }

  // Apply sort choices
  if (sortBy === 'priority-desc' || sortBy === 'priority-asc') {
    const weights = { high: 3, medium: 2, low: 1 };
    filteredTasks.sort((a, b) => {
      const wA = weights[a.priority] || 0;
      const wB = weights[b.priority] || 0;
      return sortBy === 'priority-desc' ? wB - wA : wA - wB;
    });
  } else if (sortBy === 'due-asc') {
    filteredTasks.sort((a, b) => {
      if (!a.dueDate) return 1;
      if (!b.dueDate) return -1;
      return new Date(a.dueDate) - new Date(b.dueDate);
    });
  }

  filteredTasks.forEach(task => {
    const colName = task.status;
    if (columns[colName]) {
      totals[colName]++;
      const card = createTaskCardDOM(task);
      columns[colName].appendChild(card);
    }
  });

  // Update headers count badges
  Object.keys(counts).forEach(key => {
    counts[key].innerText = totals[key];
  });
}

function createTaskCardDOM(task) {
  const card = document.createElement('div');
  card.className = 'task-card';
  card.setAttribute('draggable', 'true');
  card.setAttribute('data-id', task._id);

  // Due Date Badge Builder
  let dueHtml = '';
  if (task.dueDate) {
    const status = getDueStatus(task.dueDate);
    dueHtml = `
      <div class="due-badge ${status.class}">
        <i class="fa-regular fa-calendar"></i>
        <span>${formatDate(task.dueDate)}</span>
      </div>
    `;
  }

  // Assignees avatars builder
  let assigneesHtml = '';
  task.assignees.slice(0, 3).forEach(member => {
    assigneesHtml += `<img src="${member.avatar}" title="${member.name}" class="member-circle" alt="${member.name}">`;
  });
  if (task.assignees.length > 3) {
    assigneesHtml += `<div class="member-circle-more">+${task.assignees.length - 3}</div>`;
  }

  card.innerHTML = `
    <div class="task-card-header">
      <span class="priority-badge ${task.priority}">${task.priority}</span>
      ${dueHtml}
    </div>
    <div class="task-card-title">${task.title}</div>
    <div class="task-card-desc">${task.description || 'No description provided.'}</div>
    <div class="task-card-footer">
      <div class="members-overlap">
        ${assigneesHtml}
      </div>
      <div class="task-card-stats">
        <span><i class="fa-regular fa-comment"></i> ${task.comments.length}</span>
        <span><i class="fa-solid fa-paperclip"></i> ${task.attachments.length}</span>
      </div>
    </div>
  `;

  // Drag & Drop event bindings
  card.addEventListener('dragstart', handleDragStart);
  card.addEventListener('dragend', handleDragEnd);

  // Click details binding
  card.addEventListener('click', () => {
    openTaskDetail(task._id);
  });

  return card;
}

// --------------------------------------------------------------------------
// 9. HTML5 Drag & Drop Engine Mechanics
// --------------------------------------------------------------------------
let draggedTaskId = null;

function handleDragStart(e) {
  draggedTaskId = this.getAttribute('data-id');
  this.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', draggedTaskId);
}

function handleDragEnd(e) {
  this.classList.remove('dragging');
  draggedTaskId = null;
}

// Wire up columns listeners
document.querySelectorAll('.kanban-column .column-cards').forEach(column => {
  column.addEventListener('dragover', function (e) {
    e.preventDefault();
    this.classList.add('drag-over');
  });

  column.addEventListener('dragleave', function (e) {
    this.classList.remove('drag-over');
  });

  column.addEventListener('drop', async function (e) {
    e.preventDefault();
    this.classList.remove('drag-over');
    
    const taskId = e.dataTransfer.getData('text/plain');
    const newStatus = this.getAttribute('data-column');

    if (!taskId || !newStatus) return;

    // Find the task locally to prevent redundant transfers
    const task = state.tasks.find(t => t._id === taskId);
    if (task && task.status === newStatus) return;

    try {
      // Optimistic render updates in DOM
      if (task) {
        task.status = newStatus;
        renderKanbanBoard();
      }

      // API Patch Call
      await apiFetch(`/api/tasks/${taskId}/move`, {
        method: 'PATCH',
        body: { status: newStatus }
      });
      
      showToast('Task relocated successfully.', 'success');
    } catch (err) {
      showToast(err.message, 'error');
      // Reload on error to sync back
      await loadProjectBoard(state.currentProjectId);
    }
  });
});

// --------------------------------------------------------------------------
// 10. Modals Management (Open, Close, Submits)
// --------------------------------------------------------------------------
function openModal(id) {
  document.getElementById(id).classList.add('open');
}

function closeModal(id) {
  document.getElementById(id).classList.remove('open');
  
  // Clean active states on close
  if (id === 'modal-task-detail') {
    state.activeTaskDetailId = null;
    window.location.hash = `#project-${state.currentProjectId}`;
  }
}

// Universal modal binders
document.querySelectorAll('.btn-modal-close').forEach(btn => {
  btn.addEventListener('click', function(e) {
    e.preventDefault();
    const modalId = this.getAttribute('data-modal');
    closeModal(modalId);
  });
});

// Global close on background backdrop click
document.querySelectorAll('.modal-backdrop').forEach(backdrop => {
  backdrop.addEventListener('click', function (e) {
    if (e.target === this) {
      closeModal(this.id);
    }
  });
});

// Form: Create Project Submit
document.getElementById('form-create-project').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('create-project-name').value;
  const description = document.getElementById('create-project-desc').value;

  try {
    const project = await apiFetch('/api/projects', {
      method: 'POST',
      body: { name, description }
    });

    state.projects.unshift(project);
    renderSidebarProjects();
    renderDashboardProjects();
    closeModal('modal-create-project');
    
    // Clear form
    document.getElementById('form-create-project').reset();

    showToast(`Project "${project.name}" initialized!`, 'success');
    window.location.hash = `#project-${project._id}`;
  } catch (err) {
    showToast(err.message, 'error');
  }
});

// Button Trigger: Open Create Task Modal per column
document.querySelectorAll('.btn-column-add').forEach(btn => {
  btn.addEventListener('click', function(e) {
    e.stopPropagation();
    const column = this.getAttribute('data-column');
    document.getElementById('create-task-column').value = column;
    
    // Render assignees list checklist inside Create Task Modal
    const checklistGrid = document.getElementById('create-task-assignees-grid');
    checklistGrid.innerHTML = '';
    
    state.currentProject.members.forEach(member => {
      checklistGrid.innerHTML += `
        <label class="assignee-checkbox-label">
          <input type="checkbox" name="assignees" value="${member._id}">
          <span>${member.name}</span>
        </label>
      `;
    });

    openModal('modal-create-task');
  });
});

// Form: Create Task Submit
document.getElementById('form-create-task').addEventListener('submit', async (e) => {
  e.preventDefault();
  const title = document.getElementById('create-task-title').value;
  const description = document.getElementById('create-task-desc').value;
  const status = document.getElementById('create-task-column').value;
  const priority = document.getElementById('create-task-priority').value;
  const dueDate = document.getElementById('create-task-due').value;

  // Retrieve assigned checked boxes
  const assignees = [];
  document.querySelectorAll('input[name="assignees"]:checked').forEach(box => {
    assignees.push(box.value);
  });

  try {
    const task = await apiFetch('/api/tasks', {
      method: 'POST',
      body: {
        title,
        description,
        status,
        priority,
        dueDate: dueDate || null,
        assignees,
        project: state.currentProjectId
      }
    });

    // Client-side socket listens and inserts, but this is immediate user experience
    if (!state.tasks.some(t => t._id === task._id)) {
      state.tasks.push(task);
      renderKanbanBoard();
    }
    
    closeModal('modal-create-task');
    document.getElementById('form-create-task').reset();
    showToast('Task added to column.', 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
});

// --------------------------------------------------------------------------
// 11. Task Details Dialog Box & Comments Engine
// --------------------------------------------------------------------------
async function openTaskDetail(taskId) {
  try {
    const task = await apiFetch(`/api/tasks/${taskId}`);
    state.activeTaskDetailId = taskId;

    // Update URL hash state without breaking context
    window.location.hash = `#project-${state.currentProjectId}-task-${taskId}`;

    populateTaskDetailModal(task);
    openModal('modal-task-detail');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function populateTaskDetailModal(task) {
  // Simple fields
  document.getElementById('detail-task-id-badge').innerText = `TASK: ${task._id.substring(18)}`;
  document.getElementById('detail-task-title').innerText = task.title;
  document.getElementById('detail-task-desc').value = task.description || '';
  
  // Sidebar config matches
  document.getElementById('detail-task-status').value = task.status;
  document.getElementById('detail-task-priority').value = task.priority;
  document.getElementById('detail-task-due').value = task.dueDate ? task.dueDate.split('T')[0] : '';

  // Avatar commenter
  document.getElementById('detail-commenter-avatar').src = state.user.avatar;

  // Render assigned avatars in detail
  const avatarsContainer = document.getElementById('detail-task-assignees');
  avatarsContainer.innerHTML = '';
  task.assignees.forEach(member => {
    avatarsContainer.innerHTML += `<img src="${member.avatar}" title="${member.name}" class="member-circle" alt="${member.name}">`;
  });
  if (task.assignees.length === 0) {
    avatarsContainer.innerHTML = '<span style="font-size:0.75rem; color:var(--text-muted)">Unassigned</span>';
  }

  // Populate dynamic inline checklist modifier in sidebar
  const dropdownPicker = document.getElementById('detail-assignees-picker');
  dropdownPicker.innerHTML = '';
  state.currentProject.members.forEach(member => {
    const isChecked = task.assignees.some(a => a._id === member._id);
    const item = document.createElement('label');
    item.className = 'assignee-checkbox-label';
    item.innerHTML = `
      <input type="checkbox" class="detail-assignee-box" value="${member._id}" ${isChecked ? 'checked' : ''}>
      <span>${member.name}</span>
    `;
    item.querySelector('input').addEventListener('change', handleAssigneeQuickChange);
    dropdownPicker.appendChild(item);
  });

  // Render Attachments list
  renderAttachmentsList(task.attachments);

  // Render Comments stream
  const stream = document.getElementById('detail-comments-stream');
  stream.innerHTML = '';
  task.comments.forEach(comment => {
    const card = createCommentCardDOM(comment);
    stream.appendChild(card);
  });
  stream.scrollTop = stream.scrollHeight;
}

// Submits Inline updates for details status / priority / dates
document.getElementById('detail-task-status').addEventListener('change', updateActiveTaskMeta);
document.getElementById('detail-task-priority').addEventListener('change', updateActiveTaskMeta);
document.getElementById('detail-task-due').addEventListener('change', updateActiveTaskMeta);

// Save Description click handler
document.getElementById('btn-save-task-desc').addEventListener('click', updateActiveTaskMeta);

// Content Editable Title handler
document.getElementById('detail-task-title').addEventListener('blur', async function() {
  const newTitle = this.innerText.trim();
  if (!newTitle) return;

  try {
    await apiFetch(`/api/tasks/${state.activeTaskDetailId}`, {
      method: 'PUT',
      body: { title: newTitle }
    });
  } catch (err) {
    showToast(err.message, 'error');
  }
});

async function updateActiveTaskMeta() {
  const status = document.getElementById('detail-task-status').value;
  const priority = document.getElementById('detail-task-priority').value;
  const dueDate = document.getElementById('detail-task-due').value;
  const description = document.getElementById('detail-task-desc').value;

  try {
    await apiFetch(`/api/tasks/${state.activeTaskDetailId}`, {
      method: 'PUT',
      body: {
        status,
        priority,
        dueDate: dueDate || null,
        description
      }
    });
    showToast('Task updated successfully.', 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// Assigned list inline modifier checkbox controller
async function handleAssigneeQuickChange() {
  const checkedIds = [];
  document.querySelectorAll('.detail-assignee-box:checked').forEach(box => {
    checkedIds.push(box.value);
  });

  try {
    await apiFetch(`/api/tasks/${state.activeTaskDetailId}`, {
      method: 'PUT',
      body: { assignees: checkedIds }
    });
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// Toggle Assignees checklist slide dropdown
document.getElementById('btn-toggle-detail-assignees-picker').addEventListener('click', (e) => {
  e.stopPropagation();
  const picker = document.getElementById('detail-assignees-picker');
  picker.classList.toggle('hidden');
});
document.addEventListener('click', () => {
  document.getElementById('detail-assignees-picker').classList.add('hidden');
});
document.getElementById('detail-assignees-picker').addEventListener('click', (e) => {
  e.stopPropagation();
});

// Delete Task button action
document.getElementById('btn-delete-task').addEventListener('click', async () => {
  if (!confirm('Are you absolutely sure you want to delete this task? This is permanent.')) return;

  try {
    await apiFetch(`/api/tasks/${state.activeTaskDetailId}`, {
      method: 'DELETE'
    });
    
    // Board is automatically updated via sockets, but optimistic local update
    state.tasks = state.tasks.filter(t => t._id !== state.activeTaskDetailId);
    renderKanbanBoard();
    
    closeModal('modal-task-detail');
    showToast('Task removed.', 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
});

// --------------------------------------------------------------------------
// 12. Task File Attachments Engine
// --------------------------------------------------------------------------
function renderAttachmentsList(attachments) {
  const container = document.getElementById('detail-attachments-list');
  container.innerHTML = '';

  attachments.forEach(file => {
    const row = document.createElement('div');
    row.className = 'attachment-item';
    row.innerHTML = `
      <div class="attachment-info">
        <i class="fa-regular fa-file-lines"></i>
        <div>
          <a href="${file.url}" target="_blank" class="attachment-name">${file.name}</a>
          <span class="attachment-date">${formatDate(file.uploadedAt)}</span>
        </div>
      </div>
    `;
    container.appendChild(row);
  });

  if (attachments.length === 0) {
    container.innerHTML = '<span style="font-size:0.75rem; color:var(--text-muted)">No attachments added yet.</span>';
  }
}

// Attachment file upload binding
const fileInput = document.getElementById('attachment-file-input');
const fileLabelName = document.getElementById('attachment-file-name');
const btnSubmitAttachment = document.getElementById('btn-submit-attachment');

fileInput.addEventListener('change', function() {
  if (this.files.length > 0) {
    fileLabelName.innerText = this.files[0].name;
    btnSubmitAttachment.style.display = 'inline-flex';
  } else {
    fileLabelName.innerText = '';
    btnSubmitAttachment.style.display = 'none';
  }
});

document.getElementById('form-upload-attachment').addEventListener('submit', async function(e) {
  e.preventDefault();
  const file = fileInput.files[0];
  if (!file) return;

  const formData = new FormData();
  formData.append('attachment', file);

  try {
    btnSubmitAttachment.innerText = 'Uploading...';
    btnSubmitAttachment.disabled = true;

    const task = await apiFetch(`/api/tasks/${state.activeTaskDetailId}/attach`, {
      method: 'POST',
      body: formData
    });

    populateTaskDetailModal(task);
    
    // Clear upload previews
    fileInput.value = '';
    fileLabelName.innerText = '';
    btnSubmitAttachment.style.display = 'none';
    btnSubmitAttachment.innerText = 'Attach File';
    btnSubmitAttachment.disabled = false;
    
    showToast('File attached to task successfully.', 'success');
  } catch (err) {
    showToast(err.message, 'error');
    btnSubmitAttachment.innerText = 'Attach File';
    btnSubmitAttachment.disabled = false;
  }
});

// --------------------------------------------------------------------------
// 13. Comments Discussion Actions
// --------------------------------------------------------------------------
document.getElementById('btn-post-comment').addEventListener('click', async () => {
  const input = document.getElementById('comment-text-input');
  const text = input.value.trim();
  if (!text) return;

  try {
    const comment = await apiFetch('/api/comments', {
      method: 'POST',
      body: {
        taskId: state.activeTaskDetailId,
        text
      }
    });

    // Clear input
    input.value = '';

    // Append to list locally immediately
    const stream = document.getElementById('detail-comments-stream');
    const card = createCommentCardDOM(comment);
    stream.appendChild(card);
    stream.scrollTop = stream.scrollHeight;

    showToast('Comment posted.', 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
});

function createCommentCardDOM(comment) {
  const card = document.createElement('div');
  card.className = 'comment-card';
  card.setAttribute('data-id', comment._id);

  const isMe = comment.author._id === state.user._id;
  const deleteBtn = isMe 
    ? `<button class="btn-comment-delete" title="Delete comment"><i class="fa-regular fa-trash-can"></i></button>`
    : '';

  card.innerHTML = `
    <img src="${comment.author.avatar}" class="user-avatar" alt="Avatar">
    <div class="comment-main">
      <div class="comment-header">
        <span class="comment-author-name">${comment.author.name}</span>
        <span class="comment-time">${formatDate(comment.createdAt)}</span>
      </div>
      <p class="comment-text">${comment.text}</p>
      <div style="text-align:right;">${deleteBtn}</div>
    </div>
  `;

  if (isMe) {
    card.querySelector('.btn-comment-delete').addEventListener('click', async () => {
      if (!confirm('Delete this comment?')) return;
      try {
        await apiFetch(`/api/comments/${comment._id}`, {
          method: 'DELETE'
        });
        card.remove();
        showToast('Comment deleted.', 'success');
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  }

  return card;
}

// --------------------------------------------------------------------------
// 14. Project settings View Panel
// --------------------------------------------------------------------------
document.getElementById('btn-project-settings-trigger').addEventListener('click', () => {
  switchPanel('settings');
  loadProjectSettings();
});

function loadProjectSettings() {
  document.getElementById('settings-project-name').value = state.currentProject.name;
  document.getElementById('settings-project-desc').value = state.currentProject.description || '';

  const listContainer = document.getElementById('settings-members-list');
  listContainer.innerHTML = '';

  const isOwner = state.currentProject.owner._id === state.user._id;

  state.currentProject.members.forEach(member => {
    const isThisMemberOwner = state.currentProject.owner._id === member._id;
    let removeBtn = '';

    if (isOwner && !isThisMemberOwner) {
      removeBtn = `<button class="btn btn-danger btn-sm" onclick="removeProjectMember('${member._id}')">Remove</button>`;
    } else if (member._id === state.user._id && !isThisMemberOwner) {
      removeBtn = `<button class="btn btn-danger btn-sm" onclick="removeProjectMember('${member._id}')">Leave Project</button>`;
    }

    const row = document.createElement('div');
    row.className = 'manage-member-row';
    row.innerHTML = `
      <div class="manage-member-info">
        <img src="${member.avatar}" class="member-circle" alt="Avatar">
        <div>
          <span style="font-weight:600; display:block;">${member.name}</span>
          <span style="font-size:0.75rem; color:var(--text-muted);">${member.email}</span>
        </div>
      </div>
      <div>
        ${isThisMemberOwner ? '<span class="project-owner-badge">Owner</span>' : removeBtn}
      </div>
    `;
    listContainer.appendChild(row);
  });
}

// Form project settings update
document.getElementById('form-project-settings').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('settings-project-name').value;
  const description = document.getElementById('settings-project-desc').value;

  try {
    await apiFetch(`/api/projects/${state.currentProjectId}`, {
      method: 'PUT',
      body: { name, description }
    });
    showToast('Project metadata saved.', 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
});

// Invite member dialog
document.getElementById('btn-invite-member-trigger').addEventListener('click', () => {
  openModal('modal-invite-member');
});

// Form: Invite member submit
document.getElementById('form-invite-member').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('invite-email').value;

  try {
    const project = await apiFetch(`/api/projects/${state.currentProjectId}/invite`, {
      method: 'POST',
      body: { email }
    });

    state.currentProject = project;
    renderProjectMembers(project);
    closeModal('modal-invite-member');
    document.getElementById('form-invite-member').reset();
    showToast('Invitation sent. Team member added to project.', 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
});

// Delete Project Actions
document.getElementById('btn-delete-project').addEventListener('click', async () => {
  if (!confirm('CRITICAL ACTION: Are you sure you want to permanently delete this project? This deletes all associated boards, tasks, comments, and attachments forever.')) return;

  try {
    await apiFetch(`/api/projects/${state.currentProjectId}`, {
      method: 'DELETE'
    });
    showToast('Project permanently destroyed.', 'info');
    window.location.hash = '#dashboard';
  } catch (err) {
    showToast(err.message, 'error');
  }
});

// Global scope helpers for window listeners
window.removeProjectMember = async function(userId) {
  const isSelf = userId === state.user._id;
  const confirmMsg = isSelf 
    ? 'Are you sure you want to leave this project?'
    : 'Are you sure you want to remove this member from the project?';

  if (!confirm(confirmMsg)) return;

  try {
    const project = await apiFetch(`/api/projects/${state.currentProjectId}/members/${userId}`, {
      method: 'DELETE'
    });

    state.currentProject = project;
    if (isSelf) {
      window.location.hash = '#dashboard';
    } else {
      loadProjectSettings();
      renderProjectMembers(project);
    }
    showToast(isSelf ? 'You left the project.' : 'Member removed.', 'info');
  } catch (err) {
    showToast(err.message, 'error');
  }
};

// --------------------------------------------------------------------------
// 15. Notification Drawers Panel
// --------------------------------------------------------------------------
async function loadNotifications() {
  try {
    state.notifications = await apiFetch('/api/notifications');
    renderNotificationsList();
  } catch (err) {
    console.error('Error fetching notifications:', err);
  }
}

function renderNotificationsList() {
  const container = document.getElementById('notifications-list');
  const badge = document.getElementById('notification-badge');
  container.innerHTML = '';

  let unreadCount = 0;

  state.notifications.forEach(item => {
    if (!item.read) unreadCount++;

    const row = document.createElement('div');
    row.className = `notification-item ${item.read ? '' : 'unread'}`;
    row.innerHTML = `
      <p>${item.message}</p>
      <span class="notification-time">${formatDate(item.createdAt)}</span>
    `;

    // Click handler to redirect dynamically if link exists
    row.addEventListener('click', async () => {
      if (item.link) {
        window.location.hash = item.link;
      }
      // Close drawer
      document.getElementById('drawer-notifications').classList.remove('open');
    });

    container.appendChild(row);
  });

  badge.innerText = unreadCount;
  badge.style.display = unreadCount > 0 ? 'flex' : 'none';

  if (state.notifications.length === 0) {
    container.innerHTML = '<div class="no-data-msg" style="padding: 24px; text-align: center; color: var(--text-muted);">Notifications inbox empty</div>';
  }
}

document.getElementById('btn-notifications-trigger').addEventListener('click', (e) => {
  e.stopPropagation();
  document.getElementById('drawer-notifications').classList.toggle('open');
});

document.getElementById('btn-notifications-close').addEventListener('click', () => {
  document.getElementById('drawer-notifications').classList.remove('open');
});

// Close drawer when clicking outside
document.addEventListener('click', () => {
  document.getElementById('drawer-notifications').classList.remove('open');
});
document.getElementById('drawer-notifications').addEventListener('click', (e) => {
  e.stopPropagation();
});

// Mark all as read click action
document.getElementById('btn-mark-all-read').addEventListener('click', async (e) => {
  e.preventDefault();
  try {
    await apiFetch('/api/notifications/read', {
      method: 'PUT'
    });

    state.notifications = state.notifications.map(n => ({ ...n, read: true }));
    renderNotificationsList();
    showToast('Notifications cleared.', 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
});

// --------------------------------------------------------------------------
// 16. App Toasts / Date Utilities Helpers
// --------------------------------------------------------------------------
function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  
  let icon = 'fa-check';
  if (type === 'error') icon = 'fa-triangle-exclamation';
  if (type === 'info') icon = 'fa-bell';

  toast.innerHTML = `
    <i class="fa-solid ${icon}"></i>
    <span>${message}</span>
  `;

  container.appendChild(toast);

  // Automatically fade out after 4 seconds
  setTimeout(() => {
    toast.classList.add('fade-out');
    toast.addEventListener('animationend', () => {
      toast.remove();
    });
  }, 4000);
}

function getDueStatus(dateStr) {
  if (!dateStr) return null;
  const due = new Date(dateStr);
  const today = new Date();
  
  // Normalize time for precise daily subtraction
  due.setHours(0,0,0,0);
  today.setHours(0,0,0,0);
  
  const diffTime = due.getTime() - today.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  
  if (diffDays < 0) {
    return { label: 'Overdue', class: 'overdue' };
  } else if (diffDays === 0) {
    return { label: 'Due Today', class: 'today' };
  } else {
    return { label: `Due in ${diffDays} days`, class: 'upcoming' };
  }
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// --------------------------------------------------------------------------
// 17. App Bootstrap Initializer
// --------------------------------------------------------------------------
window.addEventListener('hashchange', handleRouter);
window.addEventListener('load', async () => {
  // Bind simple sidebar nav links
  document.getElementById('nav-dashboard').addEventListener('click', () => {
    window.location.hash = '#dashboard';
  });
  document.getElementById('nav-profile').addEventListener('click', () => {
    window.location.hash = '#profile';
  });

  // Bind dynamic board filter toolbar actions
  const searchInput = document.getElementById('board-search-input');
  const filterPriority = document.getElementById('board-filter-priority');
  const sortBy = document.getElementById('board-sort-by');

  if (searchInput) searchInput.addEventListener('input', renderKanbanBoard);
  if (filterPriority) filterPriority.addEventListener('change', renderKanbanBoard);
  if (sortBy) sortBy.addEventListener('change', renderKanbanBoard);

  // Check initial token verification
  if (state.token) {
    initSocketConnection();
    await loadUserDashboard();
  }

  // Execute initial route check
  await handleRouter();
});
