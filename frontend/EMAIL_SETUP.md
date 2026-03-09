# Email Configuration Setup

To enable email sending functionality, you need to configure your email credentials.

## Quick Setup

1. Create a `.env.local` file in the `frontend/` directory (this file is gitignored for security)

2. Add the following content to `frontend/.env.local`:

```env
# Email Configuration (required for sending emails)
SENDER_EMAIL=your_email@gmail.com
EMAIL_PASSWORD=your_app_password
```

## Getting a Gmail App Password

If you're using Gmail, you need to create an App Password:

1. Go to your [Google Account](https://myaccount.google.com/)
2. Click on **Security** in the left sidebar
3. Under "How you sign in to Google", enable **2-Step Verification** (if not already enabled)
4. After enabling 2-Step Verification, go back to Security
5. Click on **App passwords** (you may need to search for it)
6. Select **Mail** as the app and **Other (Custom name)** as the device
7. Enter "Claims System" as the name and click **Generate**
8. Copy the 16-character password (it will look like: `abcd efgh ijkl mnop`)
9. Use this password (without spaces) as your `EMAIL_PASSWORD`

## Using Other Email Providers

If you're using a different email provider (Outlook, Yahoo, etc.), you may need to configure additional SMTP settings:

```env
SENDER_EMAIL=your_email@example.com
EMAIL_PASSWORD=your_password
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false
```

## Important Notes

- The `.env.local` file is automatically gitignored and will not be committed to version control
- Never commit your actual email credentials to the repository
- After creating/updating `.env.local`, restart your Next.js development server for changes to take effect

## Restart Required

After setting up your `.env.local` file, restart your development server:

```bash
# Stop the current server (Ctrl+C)
# Then restart:
npm run dev
```
