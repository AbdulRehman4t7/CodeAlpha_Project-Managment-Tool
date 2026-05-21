# CodeAlpha Real-Time Project Management Tool

A highly premium, fully-functional, real-time project management web application (similar to Trello/Asana) designed for the CodeAlpha internship program. It is built as an end-to-end full-stack SPA utilizing modern dark glassmorphism styling, native HTML5 Drag and Drop API, Express REST APIs, MongoDB Mongoose data modeling, JWT authentication, and real-time collaboration channels via Socket.io.

---

## 🌟 Key Features

1. **Stunning Dark Glassmorphism Theme**: Built entirely on standard modern CSS. Features glowing borders, customizable scrollbars, neon highlights, dynamic hover lifts, frosted glass backgrounds, and fluid transitions.
2. **Interactive Kanban Board**: Dynamic status columns (**To Do**, **In Progress**, **Review**, **Done**) supporting native drag-and-drop operations with active drop-zone highlight indications.
3. **Task Detail Modals**: Allows detailed title edits, text descriptions, assigning members via a dropdown checkbox list, setting priority status, configuring due calendar dates, and viewing/uploading attachments.
4. **Real-time Collaboration & Synchronization**: Powered by Socket.io. Any task creation, deletion, description modification, comment addition, or column move is immediately synchronized on all active workspace users' boards without reloading the page.
5. **Real-time Notifications Engine**: Displays Toast alerts instantly on user screens upon tasks assignment or updates. Features a persistent slide-over notifications drawer detailing history with link navigation.
6. **Robust File Attachments**: Powered by Multer. Supports uploading documents, files, or media onto specific task cards, persisting paths in MongoDB, and making them downloadable.
7. **Workspace Team Management**: Create projects, rename details, invite new members by email address, remove users from projects, or safely leave joined projects. Includes a danger-zone delete trigger.
8. **Interactive User Profile**: Showcases registration metadata, projects counts, tasks assigned counts, and a dashboard detailing active task streams directly linked back to their boards.
   

---

## 📸 System Outputs

<div align="center">

<table>
  <tr>
    <td align="center">
      <img src="https://github.com/user-attachments/assets/8de2c65a-373c-46c6-b7bb-7debf414c0ed" width="230"/><br/>
      <sub><b>Login Page</b></sub>
    </td>
    <td align="center">
      <img src="https://github.com/user-attachments/assets/cec519d4-5fe0-4caa-9573-3e33a04694ab" width="420"/><br/>
      <sub><b>Dashboard View</b></sub>
    </td>
  </tr>

  <tr>
    <td align="center">
      <img src="https://github.com/user-attachments/assets/3d6707cc-0256-4983-a879-7943d4c49357" width="420"/><br/>
      <sub><b>Feature Module</b></sub>
    </td>
    <td align="center">
      <img src="https://github.com/user-attachments/assets/15e399f8-aaa5-4329-95da-fb505a1b62b6" width="300"/><br/>
      <sub><b>INVITE MEMBERS </b></sub>
    </td>
  </tr>

  <tr>
    <td colspan="2" align="center">
      <img src="https://github.com/user-attachments/assets/4c486d21-ceba-482d-884f-a9b17c724765" width="360"/><br/>
      <sub><b>aADD NEWW PROJECT</b></sub>
    </td>
  </tr>

</table>

</div>










## 🛠️ Technology Stack

- **Frontend**: HTML5, Vanilla CSS3 (Custom Grid/Flex design), Vanilla ES6 JavaScript
- **Backend**: Node.js, Express.js
- **Database**: MongoDB via Mongoose ODM
- **Real-Time Communication**: Socket.io
- **Session Authentication**: JSON Web Tokens (JWT) & bcryptjs for password hashing
- **File Uploads**: Multer middleware

---

## 📁 Repository Structure

```text
/
├── .env                       # Environment credentials configuration
├── .gitignore                 # Version control exclusions
├── package.json               # Package configurations and scripts
├── server.js                  # Master server file (Express + MongoDB + Socket.io)
├── README.md                  # Documentation and setup guide
│
├── middleware/
│   └── auth.js                # JWT session authentication middleware
│
├── models/
│   ├── User.js                # User collection schema & initials generator
│   ├── Project.js             # Project metadata collection schema
│   ├── Task.js                # Tasks collection schema (priorities, assignees, dates)
│   ├── Comment.js             # Task commenting and discussions schema
│   └── Notification.js        # Alerts and notifications collection schema
│
├── routes/
│   ├── auth.js                # Auth REST endpoints (register, login, me)
│   ├── projects.js            # Workspace CRUD, membership adjustments, and alerts
│   ├── tasks.js               # Task operations, DragRelocator, and file attach upload
│   ├── comments.js            # Discussion and commenting CRUD triggers
│   └── notifications.js       # Fetching user inbox, read badges updates
│
└── public/                    # Frontend files static directory
    ├── index.html             # Single Page Application HTML structure
    ├── style.css              # Custom premium glassmorphism styling
    ├── app.js                 # Front-end routing, drag triggers, API client, Socket handlers
    └── uploads/               # Local directory holding attachments (created on start)
```

---

## 🚀 Setup & Execution Guide

### Prerequisites
Make sure you have the following installed on your operating system:
1. **Node.js** (v16.x or higher)
2. **MongoDB Community Server** (running locally on port `27017` or an active MongoDB Atlas cluster connection string)

### 1. Clone & Navigate
Clone this repository to your local system and open the terminal in the root directory.

### 2. Install Dependencies
Execute the command below to install all project dependencies:
```bash
npm install
```

### 3. Setup Environment Variables
Create a file named `.env` in the root folder (or utilize the existing one) and configure the variables:
```env
PORT=5000
MONGODB_URI=mongodb://localhost:27017/codealpha-pm
JWT_SECRET=supersecretcodealphapmpasskey123!
```

### 4. Start the Application
Run the local development server:
```bash
# Start server in watch mode using nodemon (auto-reloads on edits)
npm run dev

# Or run standard node script
npm start
```

Your terminal should display:
```text
===================================================
  CodeAlpha Project Management Server Running!
  Local Address: http://localhost:5000
  Socket.io Engine initialized successfully.
===================================================
Successfully connected to MongoDB.
```

Open your browser and navigate to **`http://localhost:5000`** to access the application!

---

## 📡 REST API Specifications

### Authentication
- `POST /api/auth/register` : Create a user. Body: `{ name, email, password }`
- `POST /api/auth/login` : Login user. Body: `{ email, password }`
- `GET /api/auth/me` : Hydrate current logged-in user profile. (Private)

### Projects
- `GET /api/projects` : Fetch projects user belongs to. (Private)
- `POST /api/projects` : Create a project. Body: `{ name, description }` (Private)
- `GET /api/projects/:id` : Fetch detailed single project settings. (Private)
- `PUT /api/projects/:id` : Modify project settings. (Private)
- `DELETE /api/projects/:id` : Delete a project. (Private)
- `POST /api/projects/:id/invite` : Invite member by email address. Body: `{ email }` (Private)
- `DELETE /api/projects/:id/members/:userId` : Kick member from project or self leave. (Private)

### Tasks
- `POST /api/tasks` : Draft task. Body: `{ title, description, status, priority, dueDate, assignees, project }` (Private)
- `GET /api/tasks/:id` : Fetch task details, assignees, attachments, and comments. (Private)
- `PUT /api/tasks/:id` : Update task properties. Body: `{ title, description, status, priority, dueDate, assignees }` (Private)
- `PATCH /api/tasks/:id/move` : Update column status. Body: `{ status }` (Private)
- `DELETE /api/tasks/:id` : Delete task card. (Private)
- `POST /api/tasks/:id/attach` : Upload and attach a file. Form field: `attachment` (Private)

### Comments
- `POST /api/comments` : Post text comment. Body: `{ taskId, text }` (Private)
- `GET /api/comments/task/:taskId` : Load comment stream. (Private)
- `DELETE /api/comments/:id` : Remove own comment. (Private)

### Notifications
- `GET /api/notifications` : Get user notification logs. (Private)
- `PUT /api/notifications/read` : Mark all as read. (Private)

---

## 🔄 Socket.io Event Channels

### Client Emits:
- `join:project` : Registers dynamic board socket to a specific project room (`project:<id>`).
- `leave:project` : Safely unregisters socket channel from room.

### Server Broadcasts:
- `task:created` : Emits newly created task details to all active board members room.
- `task:updated` : Broadcasts task modifications to sync modals and details.
- `task:moved` : Notifies column moves immediately triggering clean animations.
- `task:deleted` : Clears task card across active screens and closes modal.
- `comment:added` : Appends text threads to discussions stream instantly.
- `notification:new` : Fires private alerts directly to recipient user room (`user:<id>`).
- `project:updated` / `project:deleted` / `project:removed` : Synchronizes workspace properties.
