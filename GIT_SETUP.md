# Git & GitHub Setup Instructions

## ✅ Git Repository Initialized

Your project is now a Git repository with all files committed. Location:

```
/Users/ivan.truedson/Analytics-3000/analytics-3000/looker-studio-extension/
```

**Status:** ✅ Initial commit complete (18 files, 5,983 insertions)

---

## 🚀 Option 1: Push to GitHub

### Step 1: Create Repository on GitHub

1. Go to [github.com/new](https://github.com/new)
2. Repository name: `looker-studio-deviation-scan`
3. Description: `Automated deviation detection for Looker Studio time-series charts`
4. Choose: Public or Private
5. **Don't** initialize with README/gitignore (we have them)
6. Click "Create repository"

### Step 2: Connect Local to GitHub

```bash
cd /Users/ivan.truedson/Analytics-3000/analytics-3000/looker-studio-extension

# Add remote (replace YOUR_USERNAME)
git remote add origin https://github.com/YOUR_USERNAME/looker-studio-deviation-scan.git

# Rename branch to main (if needed)
git branch -M main

# Push to GitHub
git push -u origin main
```

### Step 3: Verify on GitHub

- Visit: `https://github.com/YOUR_USERNAME/looker-studio-deviation-scan`
- All files should be visible
- README.md displays automatically

---

## 🚀 Option 2: Push to GitLab

### Step 1: Create Project on GitLab

1. Go to [gitlab.com/projects/new](https://gitlab.com/projects/new)
2. Project name: `looker-studio-deviation-scan`
3. Choose: Public or Private
4. Click "Create project"

### Step 2: Connect Local to GitLab

```bash
cd /Users/ivan.truedson/Analytics-3000/analytics-3000/looker-studio-extension

# Add remote (replace YOUR_USERNAME)
git remote add origin https://gitlab.com/YOUR_USERNAME/looker-studio-deviation-scan.git

# Push to GitLab
git push -u origin main
```

---

## 🚀 Option 3: Push to Gitea/Self-Hosted

```bash
git remote add origin https://your-server.com/repo.git
git push -u origin main
```

---

## 📥 How Others Download

Once pushed to GitHub/GitLab:

```bash
# Clone entire project
git clone https://github.com/YOUR_USERNAME/looker-studio-deviation-scan.git

# Or download specific branch
git clone -b main https://github.com/YOUR_USERNAME/looker-studio-deviation-scan.git

# Or download as ZIP from web interface
# GitHub: Click "Code" → "Download ZIP"
# GitLab: Click "Clone" → "Download ZIP"
```

---

## 🔄 Future Updates

After making changes locally:

```bash
# Check status
git status

# Stage changes
git add .

# Commit
git commit -m "Description of changes"

# Push to remote
git push origin main
```

---

## 📋 Current Git Status

```bash
# View logs
git log --oneline

# View remote
git remote -v

# View branch
git branch
```

---

## ✨ Git Commands Cheat Sheet

```bash
# Check status
git status

# View commits
git log --oneline -10

# Add changes
git add .
git add filename.js

# Commit
git commit -m "Message"

# Push to GitHub
git push origin main

# Pull updates
git pull origin main

# Create branch
git checkout -b feature-name

# Switch branch
git checkout main

# Delete branch
git branch -d feature-name
```

---

## 🎯 Next Steps

### To Publish on GitHub:

1. Replace `YOUR_USERNAME` in commands above
2. Run the GitHub setup commands
3. Visit your repository on GitHub

### To Keep Using Locally:

- All files are still in the folder
- You can use the extension immediately
- Git tracks all changes for future reference

### To Distribute:

1. **Team:** Share GitHub/GitLab link
2. **Chrome Web Store:** Use GitHub release as source
3. **Internal:** Share private repository link

---

## 🔐 Keep Your API Keys Safe

If you add credentials later, add to `.gitignore`:

```
# .gitignore
.env
.env.local
secrets/
*.key
```

---

**Your project is ready to share!** 🎉

Go to [github.com/new](https://github.com/new) to create your repository, then use the commands in Option 1 above.
