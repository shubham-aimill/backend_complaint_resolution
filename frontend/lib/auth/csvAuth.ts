import fs from 'fs'
import path from 'path'

// When running from frontend/, cwd is frontend; project root is parent.
// CSV may live at project root or next to package.json (frontend).
const PROJECT_ROOT = path.resolve(process.cwd(), '..')
const CSV_IN_ROOT = path.join(PROJECT_ROOT, 'login_credentials.csv')
const CSV_IN_CWD = path.join(process.cwd(), 'login_credentials.csv')
function getCsvPath(): string {
  if (fs.existsSync(CSV_IN_ROOT)) return CSV_IN_ROOT
  if (fs.existsSync(CSV_IN_CWD)) return CSV_IN_CWD
  return CSV_IN_ROOT
}
const CSV_FILE_PATH = getCsvPath()

export interface User {
  email: string
  password: string
  name: string
  phone: string
  createdAt: string
}

/**
 * Read all users from CSV file
 */
export function readUsersFromCSV(): User[] {
  try {
    // Check if file exists
    if (!fs.existsSync(CSV_FILE_PATH)) {
      return []
    }

    const fileContent = fs.readFileSync(CSV_FILE_PATH, 'utf-8')
    const lines = fileContent.trim().split('\n')
    
    // Skip header row
    if (lines.length <= 1) {
      return []
    }

    const users: User[] = []
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim()
      if (!line) continue

      // Parse CSV line (handle quoted values)
      const values = parseCSVLine(line)
      if (values.length >= 5) {
        users.push({
          email: values[0],
          password: values[1],
          name: values[2],
          phone: values[3],
          createdAt: values[4],
        })
      }
    }

    return users
  } catch (error) {
    console.error('Error reading CSV file:', error)
    return []
  }
}

/**
 * Write a new user to CSV file
 */
export function writeUserToCSV(user: Omit<User, 'createdAt'>): boolean {
  try {
    const createdAt = new Date().toISOString()
    const newUser: User = { ...user, createdAt }

    // Check if file exists, if not create it with header
    const fileExists = fs.existsSync(CSV_FILE_PATH)
    
    // Ensure data directory exists
    const dataDir = path.dirname(CSV_FILE_PATH)
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true })
    }

    // Prepare CSV line (escape commas and quotes)
    const csvLine = [
      escapeCSVValue(newUser.email),
      escapeCSVValue(newUser.password),
      escapeCSVValue(newUser.name),
      escapeCSVValue(newUser.phone),
      escapeCSVValue(newUser.createdAt),
    ].join(',')

    // Write header if file doesn't exist
    if (!fileExists) {
      const header = 'email,password,name,phone,createdAt\n'
      fs.writeFileSync(CSV_FILE_PATH, header, 'utf-8')
    }

    // Append new user
    fs.appendFileSync(CSV_FILE_PATH, csvLine + '\n', 'utf-8')
    return true
  } catch (error) {
    console.error('Error writing to CSV file:', error)
    return false
  }
}

/**
 * Validate user credentials
 */
export function validateCredentials(email: string, password: string): User | null {
  const users = readUsersFromCSV()
  const user = users.find(u => u.email.toLowerCase() === email.toLowerCase())
  
  if (user && user.password === password) {
    return user
  }
  
  return null
}

/**
 * Check if email already exists
 */
export function emailExists(email: string): boolean {
  const users = readUsersFromCSV()
  return users.some(u => u.email.toLowerCase() === email.toLowerCase())
}

/**
 * Parse a CSV line handling quoted values
 */
function parseCSVLine(line: string): string[] {
  const values: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        // Escaped quote
        current += '"'
        i++
      } else {
        // Toggle quote state
        inQuotes = !inQuotes
      }
    } else if (char === ',' && !inQuotes) {
      // End of field
      values.push(current)
      current = ''
    } else {
      current += char
    }
  }
  
  // Add last field
  values.push(current)
  
  return values
}

/**
 * Escape CSV value (add quotes if contains comma or quote)
 */
function escapeCSVValue(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}
