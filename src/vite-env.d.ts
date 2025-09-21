import { UserCookie, LabsProject, Story, VideoPrompt } from './types'; 

declare global {
  interface Window {
    electronAPI: {
      fetch: (url: string, cookie: UserCookie, options: RequestInit) => Promise<any>;
      startBrowserAutomation: (prompts: {id: string, text: string}[], cookie: UserCookie) => void;
      // THÊM DÒNG NÀY
      stopBrowserAutomation: () => void;
      onBrowserLog: (callback: (log: {promptId: string, message: string, status?: 'running' | 'success' | 'error' | 'queued', videoUrl?: string}) => void) => () => void;
    };
  }
}

export {};