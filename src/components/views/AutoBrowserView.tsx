import React, { useState, useEffect, useCallback } from 'react';
import { useAppContext } from '../../context/AppContext';
import Spinner from '../common/Spinner';
import { UserCookie, Story, VideoPrompt } from '../../types';

// Định nghĩa kiểu dữ liệu cho trạng thái tự động hóa
type AutomationStatus = 'idle' | 'running' | 'success' | 'error' | 'queued';

type AutomationPrompt = {
    id: string;
    text: string;
    status: AutomationStatus;
    message: string;
    videoUrl?: string;
};

type AutomationState = {
    prompts: AutomationPrompt[];
    isRunning: boolean;
    overallProgress: number;
    statusMessage: string;
};


const AutoBrowserView: React.FC = () => {
    const { cookies, activeCookie, setActiveCookie, stories, prompts: allPrompts } = useAppContext();
    
    const { automationState, setAutomationState } = useAppContext();
    const { prompts, isRunning, overallProgress, statusMessage } = automationState;

    const setPrompts = (updater: React.SetStateAction<AutomationPrompt[]>) => {
        setAutomationState((prev: AutomationState) => ({ ...prev, prompts: typeof updater === 'function' ? updater(prev.prompts) : updater }));
    };

    useEffect(() => {
        const unsubscribe = window.electronAPI.onBrowserLog((log: { promptId: string, message: string, status?: AutomationStatus, videoUrl?: string }) => {
            setAutomationState((prev: AutomationState) => {
                const newPrompts = prev.prompts.map((p: AutomationPrompt) => {
                    if (p.id === log.promptId) {
                        return { ...p, status: log.status || p.status, message: log.message, videoUrl: log.videoUrl || p.videoUrl };
                    }
                    return p;
                });

                const completedCount = newPrompts.filter((p: AutomationPrompt) => p.status === 'success' || p.status === 'error').length;
                const newProgress = newPrompts.length > 0 ? (completedCount / newPrompts.length) * 100 : 0;
                
                const newIsRunning = newProgress < 100 && prev.isRunning; 

                return {
                    ...prev,
                    prompts: newPrompts,
                    overallProgress: newProgress,
                    statusMessage: newIsRunning ? `Đang xử lý ${completedCount}/${newPrompts.length}...` : "Hoàn thành!",
                    isRunning: newIsRunning
                };
            });
        });
        return () => unsubscribe();
    }, []);

    const handleStoryChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const storyId = e.target.value;
        if (storyId) {
            const relatedPrompts = allPrompts.filter((p: VideoPrompt) => p.storyId === storyId);
            if (relatedPrompts.length > 0) {
                setPrompts(relatedPrompts.map((p: VideoPrompt) => ({
                    id: p.id,
                    text: p.prompt,
                    status: 'idle',
                    message: 'Sẵn sàng',
                    videoUrl: undefined,
                })));
            }
        } else {
            setPrompts([]);
        }
    };

    const handleRunSinglePrompt = (promptId: string) => {
        if (!activeCookie) {
            alert('Vui lòng chọn Cookie.');
            return;
        }
        const promptToRun = prompts.find((p: AutomationPrompt) => p.id === promptId);
        if (!promptToRun) return;

        setAutomationState((prev: AutomationState) => ({
            ...prev,
            prompts: prev.prompts.map((p: AutomationPrompt) =>
                p.id === promptId ? { ...p, status: 'queued', message: 'Đang chờ...' } : p
            ),
            isRunning: true,
            overallProgress: 0,
            statusMessage: 'Bắt đầu quá trình cho 1 prompt...'
        }));

        window.electronAPI.startBrowserAutomation([promptToRun], activeCookie);
    };

    const handleRunAll = () => {
        if (!activeCookie || prompts.length === 0) {
            alert('Vui lòng chọn Cookie và tải prompts từ một câu chuyện.');
            return;
        }
        const promptsToRun = prompts.filter((p: AutomationPrompt) => p.status !== 'success');
        setAutomationState({
            prompts: prompts.map((p: AutomationPrompt) => ({ ...p, status: 'queued', message: 'Đang chờ...' })),
            isRunning: true,
            overallProgress: 0,
            statusMessage: 'Bắt đầu quá trình...'
        });
        window.electronAPI.startBrowserAutomation(promptsToRun, activeCookie);
    };

    const handleStopAll = () => {
        window.electronAPI.stopBrowserAutomation();
        setAutomationState((prev: AutomationState) => ({ ...prev, isRunning: false, statusMessage: "Đã dừng bởi người dùng." }));
    };

    const addPromptField = () => {
        setPrompts((prev: AutomationPrompt[]) => [...prev, { id: `prompt-${Date.now()}`, text: '', status: 'idle', message: 'Sẵn sàng' }]);
    };
    
    const updatePromptText = (id: string, text: string) => {
        setPrompts(prev => prev.map((p: AutomationPrompt) => p.id === id ? { ...p, text } : p));
    };
    
    const removePrompt = (id: string) => {
        setPrompts(prev => prev.filter((p: AutomationPrompt) => p.id !== id));
    };

    const handleCookieChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const selectedCookieId = e.target.value;
        const cookie = cookies.find((c: UserCookie) => c.id === selectedCookieId) || null;
        setActiveCookie(cookie);
    };

    return (
        <div className="animate-fade-in">
            <h1 className="text-3xl font-bold text-light mb-2">Tự động hóa bằng Trình duyệt</h1>
            <p className="text-dark-text mb-6">Tự động mở trình duyệt, đăng nhập, và tạo video song song.</p>
            
            <div className="bg-secondary p-4 rounded-lg shadow-md mb-6 flex items-center gap-4 flex-wrap">
                 <div className="flex-1 min-w-[200px]">
                    <label className="block text-sm font-medium text-dark-text mb-1">Chọn Cookie Đăng nhập</label>
                    <select value={activeCookie?.id || ''} onChange={handleCookieChange} className="w-full p-2 bg-primary rounded-md border border-border-color">
                        <option value="">-- Chọn Cookie --</option>
                        {cookies.map((c: UserCookie) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                </div>
                <div className="flex-1 min-w-[200px]">
                    <label className="block text-sm font-medium text-dark-text mb-1">Tải prompt từ câu chuyện</label>
                    <select onChange={handleStoryChange} className="w-full p-2 bg-primary rounded-md border border-border-color">
                        <option value="">-- Chọn câu chuyện --</option>
                        {stories.map((s: Story) => <option key={s.id} value={s.id}>{s.title}</option>)}
                    </select>
                </div>
                <div className="flex items-end gap-2">
                    <button onClick={handleRunAll} disabled={isRunning || !activeCookie || prompts.length === 0} className="bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded-lg disabled:bg-gray-400 flex items-center">
                         Chạy tất cả
                    </button>
                    {isRunning && (
                        <button onClick={handleStopAll} className="bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-4 rounded-lg">
                            Dừng tất cả
                        </button>
                    )}
                </div>
            </div>

            {isRunning && (
                <div className="mb-6 bg-secondary p-4 rounded-lg shadow-inner">
                    <div className="flex justify-between items-center mb-2">
                        <span className="font-bold text-light">{statusMessage}</span>
                        <span className="text-sm font-semibold text-accent">{Math.round(overallProgress)}%</span>
                    </div>
                    <div className="w-full bg-primary rounded-full h-2.5">
                        <div className="bg-accent h-2.5 rounded-full transition-all duration-500" style={{ width: `${overallProgress}%` }}></div>
                    </div>
                </div>
            )}

            <div className="space-y-4">
                {prompts.map((prompt: AutomationPrompt, index: number) => (
                    <div key={prompt.id} className="bg-secondary p-4 rounded-lg shadow-md grid grid-cols-2 gap-4">
                        <div>
                             <div className="flex justify-between items-center mb-1">
                                <label className="block text-dark-text font-bold">Prompt #{index + 1}</label>
                                <div className="flex items-center gap-2">
                                     <span className={`text-xs font-bold px-2 py-1 rounded-full ${
                                         prompt.status === 'success' ? 'bg-green-100 text-green-800' : 
                                         prompt.status === 'running' || prompt.status === 'queued' ? 'bg-blue-100 text-blue-800' :
                                         prompt.status === 'error' ? 'bg-red-100 text-red-800' :
                                         'bg-gray-100 text-gray-800'
                                     }`}>{prompt.message}</span>
                                     <button onClick={() => handleRunSinglePrompt(prompt.id)} disabled={isRunning} title="Tạo video này" className="p-1 hover:bg-green-100 rounded-full disabled:opacity-50 disabled:cursor-not-allowed">
                                        <svg className="h-4 w-4 text-green-600" fill="currentColor" viewBox="0 0 20 20"><path d="M6.3 2.841A1.5 1.5 0 004 4.11V15.89a1.5 1.5 0 002.3 1.269l9.344-5.89a1.5 1.5 0 000-2.538L6.3 2.84z"></path></svg>
                                     </button>
                                     <button onClick={() => removePrompt(prompt.id)} disabled={isRunning} title="Xóa" className="p-1 hover:bg-red-100 rounded-full disabled:opacity-50 disabled:cursor-not-allowed">
                                        <svg className="h-4 w-4 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                                     </button>
                                </div>
                            </div>
                            <textarea
                                value={prompt.text}
                                onChange={e => updatePromptText(prompt.id, e.target.value)}
                                className="w-full h-32 p-2 bg-primary rounded-md border border-border-color"
                                readOnly={isRunning}
                            />
                        </div>
                        <div className="flex flex-col items-center justify-center bg-primary rounded-md border border-border-color p-2">
                            {prompt.videoUrl ? (
                                <video key={prompt.videoUrl} controls className="w-full h-full object-contain rounded-md">
                                    <source src={prompt.videoUrl} type="video/mp4" />
                                </video>
                            ) : prompt.status === 'running' || prompt.status === 'queued' ? (
                                <div className="text-center">
                                    <Spinner className="w-8 h-8 text-accent mx-auto"/>
                                    <p className="mt-2 text-dark-text text-sm">Đang xử lý...</p>
                                </div>
                            ) : (
                                <div className="text-center text-dark-text">
                                    <p>Kết quả sẽ hiện ở đây</p>
                                </div>
                            )}
                        </div>
                    </div>
                ))}
            </div>
            {!isRunning && (
                 <button onClick={addPromptField} className="mt-4 w-full bg-blue-100 hover:bg-blue-200 text-blue-800 font-bold py-2 px-4 rounded-lg border border-blue-300">
                    + Thêm Prompt
                </button>
            )}
        </div>
    );
};

export default AutoBrowserView;