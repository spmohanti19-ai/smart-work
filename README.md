# Smart Works with real payment checking

Folder: server.js, package.json, public/index.html

## 1. Razorpay (payments)
1. Sign up at razorpay.com and finish KYC so money settles to your bank account.
2. Dashboard > Account & Settings > API Keys > Generate Key. Start with Test Mode keys, switch to Live later.
3. Make sure UPI is enabled under Payment Methods.

## 2. AI (optional but needed for Homework, Career, NCERT answers)
Create a key at console.anthropic.com and add some credit.

## 3. Deploy free on Render
1. Put this folder in a GitHub repository.
2. render.com > New > Web Service > connect the repository.
3. Build command: npm install   Start command: npm start
4. Add environment variables:
   - RAZORPAY_KEY_ID
   - RAZORPAY_KEY_SECRET
   - TOKEN_SECRET (any long random text, keep it private)
   - ANTHROPIC_API_KEY
   - OWNER_CODE (your private code for free Diamond)
5. Deploy. Render gives you a link like smartworks.onrender.com.

Free Render services sleep after inactivity, so the first visit can take about 30 seconds.
