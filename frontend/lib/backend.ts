/**
 * Backend bridge - spawns Python microservices from Next.js API routes.
 * Project root is parent of frontend/ when running from frontend/.
 */

import { spawn } from 'child_process'
import path from 'path'

const PROJECT_ROOT = path.resolve(process.cwd(), '..')
const BACKEND_MODIFIED = path.join(PROJECT_ROOT, 'backend_modified')
const PY_CMD = process.platform === 'win32' ? 'python' : 'python3'

export interface SpawnResult {
  stdout: string
  stderr: string
  code: number
}

export function runPython(
  module: string,
  args: string[],
  stdin?: string
): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(PY_CMD, ['-m', module, ...args], {
      cwd: BACKEND_MODIFIED,
      env: { ...process.env, PYTHONPATH: BACKEND_MODIFIED },
      stdio: stdin !== undefined ? ['pipe', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''

    proc.stdout?.on('data', (d) => { stdout += d.toString() })
    proc.stderr?.on('data', (d) => { stderr += d.toString() })

    if (stdin !== undefined && proc.stdin) {
      proc.stdin.write(stdin, 'utf-8')
      proc.stdin.end()
    }

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr || stdout || `Python exited with code ${code}`))
      } else {
        resolve(stdout)
      }
    })

    proc.on('error', (err) => reject(err))
  })
}
