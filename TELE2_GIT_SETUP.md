# 🔧 Setup for Tele2 Internal Git Server

Your local repository is ready. To push to your internal Tele2 git server:

## Step 1: Create Repository on Gitea

1. Go to: https://git.int.tele2.com/web/analytics-3000
2. Click "New Repository" (or similar button)
3. Repository name: `looker-studio-deviation-scan`
4. Description: `Automated deviation detection for Looker Studio time-series charts`
5. Choose: Public or Private
6. **Don't** initialize with README
7. Click "Create"

## Step 2: Add Remote to Local Repository

After creating the repo, the Gitea server will show you the push URL. Run:

```bash
cd /Users/ivan.truedson/Analytics-3000/analytics-3000/looker-studio-extension

# Add the remote (URL from your Gitea repo page)
git remote add origin https://git.int.tele2.com/web/analytics-3000/looker-studio-deviation-scan.git

# Push to your internal server
git push -u origin main
```

## Step 3: Verify

Visit your Gitea repo at:
```
https://git.int.tele2.com/web/analytics-3000/looker-studio-deviation-scan
```

All files should be visible.

---

## 🔑 Authentication

If you get permission errors:

### Option 1: SSH Key (Recommended)
```bash
# Generate SSH key (if you don't have one)
ssh-keygen -t ed25519 -C "your.email@tele2.com"

# Add to Gitea: Settings → SSH Keys

# Use SSH URL instead:
git remote add origin git@git.int.tele2.com:web/analytics-3000/looker-studio-deviation-scan.git
git push -u origin main
```

### Option 2: HTTPS with Personal Access Token
1. Go to Gitea Settings → Applications
2. Create Personal Access Token
3. Use in URL: `https://USERNAME:TOKEN@git.int.tele2.com/web/analytics-3000/looker-studio-deviation-scan.git`

### Option 3: Cached Credentials
```bash
# Save credentials
git config --global credential.helper osxkeychain

# Then push normally
git push -u origin main
```

---

## 📍 Current Status

```
Location: /Users/ivan.truedson/Analytics-3000/analytics-3000/looker-studio-extension
Status: Ready to push
Files: 20 committed
Branch: main
Remote: Not yet configured
```

## 🚀 Once Remote is Set Up

```bash
# Push any future changes
git push origin main

# Pull latest from server
git pull origin main

# Check status
git remote -v
```

---

**Contact your Gitea admin if you need help creating the repository.**
