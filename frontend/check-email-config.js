#!/usr/bin/env node

/**
 * Script to check email configuration
 * Verifies that SENDER_EMAIL and EMAIL_PASSWORD are set
 */

const path = require('path')
const fs = require('fs')

const rootEnvPath = path.resolve(__dirname, '..', '.env')
const frontendEnvPath = path.resolve(__dirname, '.env.local')
const frontendEnvPath2 = path.resolve(__dirname, '.env')

console.log('Email Configuration Check')
console.log('==========================\n')

// Check root .env
let rootHasEmail = false
if (fs.existsSync(rootEnvPath)) {
  console.log('✓ Found .env in project root')
  try {
    const content = fs.readFileSync(rootEnvPath, 'utf8')
    const hasSenderEmail = /^SENDER_EMAIL\s*=/m.test(content)
    const hasEmailPassword = /^EMAIL_PASSWORD\s*=/m.test(content)
    
    if (hasSenderEmail && hasEmailPassword) {
      console.log('✓ Root .env contains SENDER_EMAIL and EMAIL_PASSWORD')
      rootHasEmail = true
    } else {
      console.log('✗ Root .env missing email credentials')
      if (!hasSenderEmail) console.log('  - Missing SENDER_EMAIL')
      if (!hasEmailPassword) console.log('  - Missing EMAIL_PASSWORD')
    }
  } catch (err) {
    console.log('✗ Could not read root .env:', err.message)
  }
} else {
  console.log('✗ No .env file found in project root')
}

// Check frontend .env.local
let frontendHasEmail = false
if (fs.existsSync(frontendEnvPath)) {
  console.log('\n✓ Found .env.local in frontend directory')
  try {
    const content = fs.readFileSync(frontendEnvPath, 'utf8')
    const hasSenderEmail = /^SENDER_EMAIL\s*=/m.test(content)
    const hasEmailPassword = /^EMAIL_PASSWORD\s*=/m.test(content)
    
    if (hasSenderEmail && hasEmailPassword) {
      console.log('✓ Frontend .env.local contains SENDER_EMAIL and EMAIL_PASSWORD')
      frontendHasEmail = true
    } else {
      console.log('✗ Frontend .env.local missing email credentials')
    }
  } catch (err) {
    console.log('✗ Could not read frontend .env.local:', err.message)
  }
} else {
  console.log('\n✗ No .env.local file found in frontend directory')
}

// Check frontend .env
if (fs.existsSync(frontendEnvPath2)) {
  console.log('\n✓ Found .env in frontend directory')
  try {
    const content = fs.readFileSync(frontendEnvPath2, 'utf8')
    const hasSenderEmail = /^SENDER_EMAIL\s*=/m.test(content)
    const hasEmailPassword = /^EMAIL_PASSWORD\s*=/m.test(content)
    
    if (hasSenderEmail && hasEmailPassword) {
      console.log('✓ Frontend .env contains SENDER_EMAIL and EMAIL_PASSWORD')
      frontendHasEmail = true
    }
  } catch (err) {
    console.log('✗ Could not read frontend .env:', err.message)
  }
}

// Summary
console.log('\n' + '='.repeat(50))
if (rootHasEmail || frontendHasEmail) {
  console.log('✓ Email configuration found!')
  console.log('\nNote: Next.js will load from:')
  if (frontendHasEmail) {
    console.log('  - frontend/.env.local (highest priority)')
    console.log('  - frontend/.env')
  }
  if (rootHasEmail) {
    console.log('  - root/.env (loaded via next.config.js)')
  }
  console.log('\n⚠️  Remember to restart your Next.js server after changes!')
} else {
  console.log('✗ Email configuration NOT found!')
  console.log('\nTo fix this:')
  console.log('1. Add SENDER_EMAIL and EMAIL_PASSWORD to root/.env, OR')
  console.log('2. Create frontend/.env.local with:')
  console.log('   SENDER_EMAIL=your_email@gmail.com')
  console.log('   EMAIL_PASSWORD=your_app_password')
  console.log('\nSee frontend/EMAIL_SETUP.md for detailed instructions.')
  process.exit(1)
}
