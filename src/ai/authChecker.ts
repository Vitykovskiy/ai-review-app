import { AIProvider } from './aiProvider';

const POLL_INTERVAL_MS = 30_000;

export async function waitForAuth(provider: AIProvider): Promise<void> {
  let instructionsPrinted = false;

  while (true) {
    const authed = await provider.checkAuth();
    if (authed) return;

    if (!instructionsPrinted) {
      console.log(provider.getAuthInstructions());
      instructionsPrinted = true;
    } else {
      console.log(`[auth] Still waiting for ${provider.name} authentication...`);
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}
