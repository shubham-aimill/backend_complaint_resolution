# Email Configuration Fix

## Current Status

✅ **Fixed**: Updated `next.config.js` to load environment variables from the project root `.env` file

❌ **Issue**: The root `.env` file exists but does not contain `SENDER_EMAIL` and `EMAIL_PASSWORD`

## Solution

You have **two options** to fix this:

### Option 1: Add to Root .env (Recommended)

Add the following lines to the `.env` file in the **project root** (same directory as `package.json`):

```env
SENDER_EMAIL=your_email@gmail.com
EMAIL_PASSWORD=your_app_password
```

**For Gmail users**: You need to use an **App Password**, not your regular password:
1. Go to [Google Account Settings](https://myaccount.google.com/)
2. Security → Enable 2-Step Verification (if not already enabled)
3. Security → App Passwords
4. Generate a new app password for "Mail"
5. Use the 16-character password (without spaces)

### Option 2: Create Frontend .env.local

Create a file `frontend/.env.local` with:

```env
SENDER_EMAIL=your_email@gmail.com
EMAIL_PASSWORD=your_app_password
```

## Verification

After adding the credentials, run:

```bash
cd frontend
node check-email-config.js
```

This will verify that the email configuration is properly set up.

## Restart Required

**IMPORTANT**: After adding the email credentials, you **must restart** your Next.js development server:

```bash
# Stop the server (Ctrl+C)
# Then restart:
npm run dev
```

## Files Modified

- ✅ `frontend/next.config.js` - Now loads env vars from project root
- ✅ `frontend/check-email-config.js` - Verification script
- ✅ `frontend/EMAIL_SETUP.md` - Detailed setup guide
- ✅ `frontend/setup-email-env.sh` - Interactive setup script

## Next Steps

1. Open the root `.env` file (in the project root directory)
2. Add `SENDER_EMAIL` and `EMAIL_PASSWORD` lines
3. Save the file
4. Restart your Next.js server
5. Test email sending functionality

The configuration will now work! 🎉
