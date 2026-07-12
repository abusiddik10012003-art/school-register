# School Register

A web app for tracking students and their results across the whole school,
with two roles:

- **Admin** — sees every student, every class, can create teacher/admin accounts
- **Teacher** — sees and edits only students in their own assigned class

Multiple people can log in from different devices at the same time once this
is hosted online.

---

## 1. Run it on your own computer first (recommended before hosting)

You need [Node.js](https://nodejs.org) installed (version 18 or newer).

```bash
cd school-register
npm install
npm start
```

Then open **http://localhost:3000/login.html** in your browser.

### First login

The first time the server starts, it creates a default admin account and
prints it in the terminal:

```
Email:    admin@school.local
Password: ChangeMe123!
```

**Log in with this immediately and change the password** (Account tab), or
better — create your own admin account with a real email, then delete the
default one.

### Adding teachers

Once logged in as admin, go to **Manage Users** → fill in the teacher's name,
email, a temporary password, role = Teacher, and their class name (this must
match the class name you'll use for their students exactly, e.g. `Class 4`).
Give the teacher their email + temporary password so they can log in and
change it themselves under **Account**.

---

## 2. Put it online so any device can reach it

The easiest free option is **Render.com**. Steps:

1. Create a free account at https://render.com
2. Create a new **GitHub** repository and upload this whole folder to it
   (or use Render's "deploy from a folder" option if offered)
3. In Render, click **New → Web Service**, connect your repository
4. Set:
   - **Build command:** `npm install`
   - **Start command:** `npm start`
5. Under **Environment Variables**, add:
   - `JWT_SECRET` = any long random string (e.g. mash your keyboard for 40 characters)
   - `NODE_ENV` = `production`
6. Click **Deploy**

Render will give you a URL like `https://your-school-register.onrender.com`
— that's the link every teacher uses to log in, from any device, anywhere
with internet.

**Important:** the free tier on Render "sleeps" after inactivity and the
database resets on redeploy unless you attach a persistent disk. For a school
actually relying on this data long-term, either:
- Add Render's free persistent disk (Settings → Disks) mounted at the project
  folder, so `school.db` survives restarts, or
- Ask me to switch the database to a hosted option (e.g. free-tier Postgres
  on Render/Supabase) which is safer for real production use.

I'd recommend doing a short trial first, then upgrading storage once you're
confident this is the system you want to rely on.

---

## 3. Backing up your data

Any time, click **Export CSV** on the Students page — this downloads all
visible students and their results as a spreadsheet. Do this regularly
regardless of hosting setup.

---

## Project structure

```
school-register/
├── server/
│   ├── index.js      → API routes (students, results, users, auth)
│   ├── db.js          → database setup + first-run admin account
│   └── auth.js         → login sessions and role checks
├── public/
│   ├── login.html
│   ├── index.html      → main dashboard
│   ├── app.js           → frontend logic
│   └── style.css
├── package.json
├── .env.example
└── README.md
```
