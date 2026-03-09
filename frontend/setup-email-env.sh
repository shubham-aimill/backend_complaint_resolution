#!/bin/bash

# Script to help set up email environment variables
# This creates a .env.local file in the frontend directory

FRONTEND_DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="$FRONTEND_DIR/.env.local"

echo "Email Configuration Setup"
echo "========================"
echo ""
echo "This script will help you create a .env.local file for email configuration."
echo ""

# Check if .env.local already exists
if [ -f "$ENV_FILE" ]; then
    echo "⚠️  .env.local already exists!"
    read -p "Do you want to overwrite it? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Aborted. Existing file preserved."
        exit 0
    fi
fi

echo "Enter your email configuration:"
echo ""

# Get email address
read -p "SENDER_EMAIL (e.g., your_email@gmail.com): " SENDER_EMAIL
if [ -z "$SENDER_EMAIL" ]; then
    echo "Error: SENDER_EMAIL cannot be empty"
    exit 1
fi

# Get email password
echo ""
echo "For Gmail, use an App Password (not your regular password)"
echo "See EMAIL_SETUP.md for instructions on creating an App Password"
read -p "EMAIL_PASSWORD: " -s EMAIL_PASSWORD
echo ""
if [ -z "$EMAIL_PASSWORD" ]; then
    echo "Error: EMAIL_PASSWORD cannot be empty"
    exit 1
fi

# Write to .env.local
cat > "$ENV_FILE" << EOF
# Email Configuration (required for sending emails)
# Generated on $(date)

SENDER_EMAIL=$SENDER_EMAIL
EMAIL_PASSWORD=$EMAIL_PASSWORD
EOF

echo ""
echo "✅ Successfully created $ENV_FILE"
echo ""
echo "⚠️  Important: Restart your Next.js development server for changes to take effect:"
echo "   1. Stop the current server (Ctrl+C)"
echo "   2. Run: npm run dev"
echo ""
