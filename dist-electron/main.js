"use strict";
const { app, BrowserWindow, screen: electronScreen, ipcMain } = require("electron");
const path = require("path");
const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
puppeteer.use(StealthPlugin());
let browser = null;
async function handleApiRequest(_event, { url, cookie, options }) {
  try {
    const targetUrl = new URL(url);
    let headers = {
      "Content-Type": "application/json",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      ...options.headers
    };
    if (targetUrl.hostname === "labs.google") {
      headers = { ...headers, "Accept": "*/*", "Cookie": cookie.value, "Origin": "https://labs.google", "Referer": "https://labs.google/", "X-Same-Domain": "1" };
    } else if (targetUrl.hostname === "aisandbox-pa.googleapis.com") {
      if (!cookie.bearerToken) throw new Error("Bearer Token is required.");
      headers = { ...headers, "Accept": "application/json, text/plain, */*", "Authorization": `Bearer ${cookie.bearerToken}`, "Cookie": cookie.value, "Origin": "https://labs.google", "Referer": "https://labs.google/" };
    }
    const body = typeof options.body === "object" ? JSON.stringify(options.body) : options.body;
    const response = await fetch(url, { ...options, headers, body });
    if (!response.ok) {
      const errorText = await response.text();
      console.error("API Error Response:", errorText);
      throw new Error(`API request to ${url} failed with status ${response.status}`);
    }
    const text = await response.text();
    return text ? JSON.parse(text) : {};
  } catch (error) {
    console.error(`Failed to fetch ${url}`, error);
    throw new Error(error.message || "An unknown network error occurred.");
  }
}
ipcMain.on("browser:stop-automation", async () => {
  if (browser && browser.isConnected()) {
    await browser.close();
    browser = null;
    console.log("Browser đã được đóng theo yêu cầu.");
  }
});
ipcMain.on("browser:start-automation", async (event, { prompts }) => {
  const mainWindow = BrowserWindow.fromWebContents(event.sender);
  const sendLog = (promptId, message, status, videoUrl = null) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("browser:log", { promptId, message, status, videoUrl });
    }
    console.log(`[${promptId || "general"}] ${status.toUpperCase()}: ${message}`);
  };
  if (browser && browser.isConnected()) {
    await browser.close();
  }
  browser = null;
  const firstPromptId = prompts[0]?.id || "automation-task";
  const completedPrompts = /* @__PURE__ */ new Set();
  try {
    const userDataDir = path.join(app.getPath("userData"), "puppeteer_profile");
    browser = await puppeteer.launch({
      headless: false,
      defaultViewport: null,
      args: ["--start-maximized"],
      userDataDir
    });
    const page = (await browser.pages())[0];
    await page.goto("https://labs.google/fx/vi/tools/flow", { waitUntil: "networkidle2" });
    if (page.url().includes("accounts.google.com")) {
      sendLog(firstPromptId, "Vui lòng đăng nhập", "running");
      await page.waitForNavigation({ timeout: 3e5, waitUntil: "networkidle2" });
    }
    if (!page.url().includes("/project/")) {
      sendLog(firstPromptId, "Đang tạo project mới...", "running");
      const newProject = await page.evaluate(() => {
        return fetch("https://labs.google/fx/api/trpc/project.createProject", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ json: { projectTitle: `Veo Project Auto - ${(/* @__PURE__ */ new Date()).toLocaleString()}`, toolName: "PINHOLE" } })
        }).then((res) => res.json());
      });
      const projectId = newProject?.result?.data?.json?.result?.projectId;
      if (!projectId) throw new Error("Không thể tạo dự án mới qua API.");
      const newProjectUrl = `https://labs.google/fx/vi/tools/flow/project/${projectId}`;
      await page.goto(newProjectUrl, { waitUntil: "networkidle2" });
    }
    const promptInputSelector = "textarea#PINHOLE_TEXT_AREA_ELEMENT_ID";
    await page.waitForSelector(promptInputSelector, { timeout: 6e4 });
    const MAX_CONCURRENT = 5;
    let promptIndex = 0;
    const totalPrompts = prompts.length;
    const processingPrompts = /* @__PURE__ */ new Map();
    page.on("response", async (response) => {
      if (response.url().includes("video:batchAsyncGenerateVideoText")) {
        try {
          const json = await response.json();
          const operationData = json?.operations?.[0];
          if (operationData?.operation?.name && operationData?.sceneId) {
            const sentPrompt = Array.from(processingPrompts.entries()).find(([id, data]) => !data.operationName);
            if (sentPrompt) {
              const promptId = sentPrompt[0];
              processingPrompts.set(promptId, {
                operationName: operationData.operation.name,
                sceneId: operationData.sceneId
              });
              sendLog(promptId, "Đã nhận operation, đang xử lý...", "running");
            }
          }
        } catch (e) {
        }
      }
    });
    while (completedPrompts.size < totalPrompts) {
      if (!browser.isConnected()) {
        sendLog(firstPromptId, "Trình duyệt đã bị đóng.", "error");
        break;
      }
      if (processingPrompts.size < MAX_CONCURRENT && promptIndex < totalPrompts) {
        const prompt = prompts[promptIndex];
        promptIndex++;
        try {
          sendLog(prompt.id, "Đang gửi yêu cầu...", "running");
          await page.type(promptInputSelector, prompt.text, { delay: 10 });
          await page.evaluate(() => {
            const btn = Array.from(document.querySelectorAll("button")).find((b) => b.querySelector(".google-symbols")?.textContent.trim() === "arrow_forward");
            if (btn) btn.click();
            else throw new Error("Không tìm thấy nút gửi prompt.");
          });
          processingPrompts.set(prompt.id, { operationName: null, sceneId: null });
          await page.click(promptInputSelector, { clickCount: 3 });
          await page.keyboard.press("Backspace");
        } catch (promptError) {
          sendLog(prompt.id, `Lỗi khi gửi: ${promptError.message}`, "error");
          completedPrompts.add(prompt.id);
        }
      }
      const operationsToCheck = Array.from(processingPrompts.entries()).filter(([id, data]) => data.operationName && !completedPrompts.has(id)).map(([id, data]) => ({ operation: { name: data.operationName }, sceneId: data.sceneId, promptId: id }));
      if (operationsToCheck.length > 0) {
        const statusResponse = await page.evaluate((ops) => {
          return fetch("https://aisandbox-pa.googleapis.com/v1/video:batchCheckAsyncVideoGenerationStatus", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ operations: ops.map((op) => ({ operation: op.operation, sceneId: op.sceneId })) })
          }).then((res) => res.json());
        }, operationsToCheck);
        if (statusResponse && statusResponse.operations) {
          for (const operationStatus of statusResponse.operations) {
            const sceneId = operationStatus?.operation?.metadata?.sceneId;
            const matchingPrompt = operationsToCheck.find((op) => op.sceneId === sceneId);
            if (matchingPrompt) {
              const promptId = matchingPrompt.promptId;
              if (operationStatus?.status === "MEDIA_GENERATION_STATUS_SUCCESSFUL") {
                const videoUrl = operationStatus?.operation?.metadata?.video?.fifeUrl;
                sendLog(promptId, "Hoàn thành", "success", videoUrl);
                completedPrompts.add(promptId);
              } else if (operationStatus?.status === "MEDIA_GENERATION_STATUS_FAILED") {
                sendLog(promptId, `Lỗi: ${operationStatus?.error?.message || "Không rõ"}`, "error");
                completedPrompts.add(promptId);
              } else {
                sendLog(promptId, `Đang xử lý (${operationStatus?.status || "PENDING"})...`, "running");
              }
            }
          }
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 5e3));
    }
    sendLog(firstPromptId, "Tất cả các prompt đã được xử lý!", "success");
  } catch (error) {
    let errorMessage = `Lỗi nghiêm trọng: ${error.message}`;
    if (error.name === "TimeoutError") errorMessage = "Lỗi: Hết thời gian chờ.";
    prompts.forEach((p) => {
      if (!completedPrompts.has(p.id)) sendLog(p.id, errorMessage, "error");
    });
  }
});
function createWindow() {
  const primaryDisplay = electronScreen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;
  const mainWindow = new BrowserWindow({
    width,
    height,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.js")
    }
  });
  const VITE_DEV_SERVER_URL = process.env["VITE_DEV_SERVER_URL"];
  if (VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }
}
app.whenReady().then(() => {
  ipcMain.handle("fetch-api", handleApiRequest);
  createWindow();
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
