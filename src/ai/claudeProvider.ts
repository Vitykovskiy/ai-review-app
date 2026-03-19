import { spawn } from 'child_process';
import { ReviewResult } from '../types';
import { AIProvider } from './aiProvider';

export class ClaudeProvider implements AIProvider {
  name = 'claude';

  constructor(private timeoutMs: number) {}

  async checkAuth(): Promise<boolean> {
    return new Promise((resolve) => {
      const proc = spawn('claude', ['auth', 'status', '--output-format', 'json'], { stdio: 'pipe' });
      let stdout = '';
      proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
      proc.on('close', (code) => {
        if (code !== 0) { resolve(false); return; }
        try {
          const parsed = JSON.parse(stdout);
          resolve(parsed.loggedIn === true);
        } catch {
          resolve(false);
        }
      });
      proc.on('error', () => resolve(false));
      setTimeout(() => { proc.kill(); resolve(false); }, 10000);
    });
  }

  getAuthInstructions(): string {
    return [
      '',
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      '  Claude CLI is not authenticated.',
      '  Run the following command to log in:',
      '',
      '    docker compose exec review-bot claude auth login',
      '',
      '  Follow the URL shown in the terminal.',
      '  The server will continue automatically after login.',
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      '',
    ].join('\n');
  }

  async review(prompt: string): Promise<ReviewResult> {
    const output = await this.runCLI(prompt);
    return this.parseOutput(output);
  }

  private runCLI(prompt: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const controller = new AbortController();
      const timer = setTimeout(() => {
        controller.abort();
        proc.kill('SIGTERM');
        setTimeout(() => proc.kill('SIGKILL'), 5000);
        reject(new Error(`Claude CLI timed out after ${this.timeoutMs}ms`));
      }, this.timeoutMs);

      const proc = spawn(
        'claude',
        ['--print', '--output-format', 'text'],
        { stdio: ['pipe', 'pipe', 'pipe'] }
      );

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
      proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });

      proc.stdin.write(prompt);
      proc.stdin.end();

      proc.on('close', (code) => {
        clearTimeout(timer);
        if (code !== 0) {
          reject(new Error(`Claude CLI exited with code ${code}. stderr: ${stderr}`));
        } else {
          resolve(stdout);
        }
      });

      proc.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  private parseOutput(output: string): ReviewResult {
    // Extract JSON from output (model may add markdown fences)
    const jsonMatch = output.match(/```(?:json)?\s*([\s\S]*?)```/) ||
                      output.match(/(\{[\s\S]*\})/);

    if (!jsonMatch) {
      return {
        action: 'COMMENT',
        body: `AI review output could not be parsed as JSON. Raw output:\n\n${output}`,
        comments: [],
      };
    }

    try {
      const parsed = JSON.parse(jsonMatch[1]) as ReviewResult;
      if (!['APPROVE', 'REQUEST_CHANGES', 'COMMENT'].includes(parsed.action)) {
        throw new Error(`Invalid action: ${parsed.action}`);
      }
      return {
        action: parsed.action,
        body: parsed.body || '',
        comments: Array.isArray(parsed.comments) ? parsed.comments : [],
      };
    } catch (err) {
      return {
        action: 'COMMENT',
        body: `AI review output could not be parsed. Error: ${err}\n\nRaw output:\n\n${output}`,
        comments: [],
      };
    }
  }
}
