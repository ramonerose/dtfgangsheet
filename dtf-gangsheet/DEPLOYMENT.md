# EZGangSheets Deployment Guide

## Railway Deployment

### Prerequisites
- Railway account (https://railway.app)
- GitHub repository with your code
- Domain name (optional)

### Step 1: Connect to Railway
1. Go to https://railway.app
2. Click "New Project"
3. Select "Deploy from GitHub repo"
4. Connect your GitHub account
5. Select your EZGangSheets repository

### Step 2: Configure Environment
1. Railway will automatically detect it's a Node.js project
2. The `railway.json` file will configure the deployment
3. No additional environment variables needed for basic deployment

### Step 3: Deploy
1. Railway will automatically build and deploy your app
2. You'll get a Railway-provided URL (e.g., `https://ezgangsheets-production.up.railway.app`)
3. The app will be available immediately

### Step 4: Custom Domain (Optional)
1. In your Railway project dashboard, go to "Settings"
2. Click "Domains"
3. Add your custom domain
4. Update your domain's DNS to point to Railway

### Step 5: Environment Variables (Production)
Set these in Railway dashboard if needed:
- `NODE_ENV=production`
- `PORT=8080` (Railway sets this automatically)

### Monitoring
- Railway provides built-in monitoring
- Check logs in the Railway dashboard
- Set up alerts for errors

### Scaling
- Railway automatically scales based on traffic
- Upgrade plan if you need more resources

## Local Development
```bash
npm install
npm run dev
```

## Production Commands
```bash
npm start
```

## File Structure
```
EZGangSheets/
├── index.js              # Main application
├── package.json          # Dependencies
├── railway.json          # Railway configuration
├── vercel.json           # Vercel configuration (backup)
├── public/               # Static files
│   └── index.html        # Frontend
└── DEPLOYMENT.md         # This file
``` 