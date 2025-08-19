import * as vscode from 'vscode';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

let trackingStart: number | null = null;
let currentBranch: string | null = null;
let branchTimeMap: Record<string, Record<string, number>> = {}; // workspace -> branch -> time
let idleTimer: NodeJS.Timeout | null = null;
let globalContext: vscode.ExtensionContext;
let lastTrackedBranch: string | null = null;
let currentWorkspace: string = '';

// Storage keys
const STORAGE_KEYS = {
    BRANCH_TIME_MAP: 'branchTimeMap',
    LAST_TRACKED_BRANCH: 'lastTrackedBranch',
    LAST_TRACKING_START: 'lastTrackingStart',
    CURRENT_WORKSPACE: 'currentWorkspace'
};

function getWorkspaceId(): string {
    if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
        return '';
    }
    const workspacePath = vscode.workspace.workspaceFolders[0].uri.fsPath;
    // Create a unique but readable workspace identifier
    const workspaceName = path.basename(workspacePath);
    const workspaceHash = Buffer.from(workspacePath).toString('base64').slice(0, 8);
    return `${workspaceName}_${workspaceHash}`;
}

function loadTrackedTimes() {
    try {
        // Load from global storage (no local files)
        const savedData = globalContext.globalState.get<Record<string, Record<string, number>>>(STORAGE_KEYS.BRANCH_TIME_MAP);
        if (savedData) {
            branchTimeMap = savedData;
            console.log('📦 Loaded time data from global storage');
        }
    } catch (err) {
        console.error('⚠️ Error loading time data:', err);
        branchTimeMap = {};
    }
}

function saveTrackedTimes() {
    try {
        globalContext.globalState.update(STORAGE_KEYS.BRANCH_TIME_MAP, branchTimeMap);
        console.log('💾 Saved time data to global storage');
    } catch (err) {
        console.error('❌ Error saving time data:', err);
    }
}

function getCurrentWorkspaceBranches(): Record<string, number> {
    if (!currentWorkspace || !branchTimeMap[currentWorkspace]) {
        return {};
    }
    return branchTimeMap[currentWorkspace];
}

function updateBranchTime(branch: string, seconds: number) {
    if (!currentWorkspace) return;
    
    if (!branchTimeMap[currentWorkspace]) {
        branchTimeMap[currentWorkspace] = {};
    }
    
    branchTimeMap[currentWorkspace][branch] = (branchTimeMap[currentWorkspace][branch] || 0) + seconds;
    saveTrackedTimes();
}

export function activate(context: vscode.ExtensionContext) {
    console.log('🔥 Branch Time Tracker is active');

    if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
        vscode.window.showWarningMessage('⚠️ Please open a folder to use Branch Time Tracker.');
        return;
    }

    currentWorkspace = getWorkspaceId();
    globalContext = context;

    // Load all time data
    loadTrackedTimes();

    // Session recovery logic
    const lastBranch = context.globalState.get<string>(STORAGE_KEYS.LAST_TRACKED_BRANCH);
    const lastStartTime = context.globalState.get<number>(STORAGE_KEYS.LAST_TRACKING_START);
    const lastWorkspace = context.globalState.get<string>(STORAGE_KEYS.CURRENT_WORKSPACE);
    const MAX_SESSION_AGE_MS = 10 * 60 * 1000;

    if (lastBranch && lastStartTime && lastWorkspace === currentWorkspace) {
        const age = Date.now() - lastStartTime;
        if (age < MAX_SESSION_AGE_MS) {
            currentBranch = lastBranch;
            lastTrackedBranch = lastBranch;
            trackingStart = lastStartTime;
            console.log(`🔁 Resumed tracking for branch "${currentBranch}" from last session (${Math.floor(age / 1000)}s ago)`);
            resetIdleTimer();
        } else {
            console.log(`⏱️ Skipped stale session for branch "${lastBranch}", started ${Math.floor(age / 1000)}s ago`);
            clearSessionData();
        }
    }

    // Event listeners
    vscode.window.onDidChangeWindowState((state) => {
        if (state.focused) {
            startTrackingIfBranchFound();
        } else {
            stopAndLogTime();
        }
    });

    vscode.window.onDidChangeTextEditorSelection(() => {
        resetIdleTimer();
    });

    vscode.window.onDidChangeActiveTextEditor(() => {
        startTrackingIfBranchFound();
    });
    
    vscode.workspace.onDidChangeTextDocument(() => {
        startTrackingIfBranchFound();
    });

    // Commands
    let startCommand = vscode.commands.registerCommand('branchTimer.start', () => {
        startTrackingIfBranchFound();
    });
    context.subscriptions.push(startCommand);

    let showTotalTime = vscode.commands.registerCommand('branchTimer.showTotalTime', () => {
        const workspaceBranches = getCurrentWorkspaceBranches();
        
        if (Object.keys(workspaceBranches).length === 0) {
            vscode.window.showInformationMessage('📭 No tracked time found for this workspace.');
            return;
        }

        const timeEntries = Object.entries(workspaceBranches)
            .sort(([,a], [,b]) => b - a) // Sort by time spent (descending)
            .map(([branch, seconds]) => {
                const hrs = Math.floor(seconds / 3600);
                const mins = Math.floor((seconds % 3600) / 60);
                const secs = seconds % 60;
                return `${branch}: ${hrs}h ${mins}m ${secs}s`;
            })
            .join('\n');

        vscode.window.showInformationMessage(`📊 Branch Time Summary (${currentWorkspace}):\n${timeEntries}`, { modal: true });
    });
    context.subscriptions.push(showTotalTime);

    let viewTimeReport = vscode.commands.registerCommand('branchTimer.viewTimeReport', () => {
        showTimeReportWebview(context);
    });
    context.subscriptions.push(viewTimeReport);

    let exportTimeData = vscode.commands.registerCommand('branchTimer.exportTimeData', () => {
        exportTimeDataToFile();
    });
    context.subscriptions.push(exportTimeData);

    let clearTimeData = vscode.commands.registerCommand('branchTimer.clearTimeData', () => {
        clearWorkspaceTimeData();
    });
    context.subscriptions.push(clearTimeData);
}

function clearSessionData() {
    globalContext.globalState.update(STORAGE_KEYS.LAST_TRACKED_BRANCH, null);
    globalContext.globalState.update(STORAGE_KEYS.LAST_TRACKING_START, null);
    globalContext.globalState.update(STORAGE_KEYS.CURRENT_WORKSPACE, null);
}

function showTimeReportWebview(context: vscode.ExtensionContext) {
    const workspaceBranches = getCurrentWorkspaceBranches();
    
    if (Object.keys(workspaceBranches).length === 0) {
        vscode.window.showInformationMessage('📭 No tracked time found for this workspace.');
        return;
    }

    const panel = vscode.window.createWebviewPanel(
        'branchTimeReport',
        `📈 Branch Time Report - ${currentWorkspace}`,
        vscode.ViewColumn.One,
        { enableScripts: true }
    );

    const sortedBranches = Object.entries(workspaceBranches).sort(([,a], [,b]) => b - a);
    
    const tableRows = sortedBranches.map(([branch, seconds]) => {
        const hrs = Math.floor(seconds / 3600);
        const mins = Math.floor((seconds % 3600) / 60);
        const secs = seconds % 60;
        return `<tr><td>${branch}</td><td>${hrs}h ${mins}m ${secs}s</td><td>${(seconds / 3600).toFixed(2)}</td></tr>`;
    }).join('');

    const chartData = JSON.stringify(sortedBranches.map(([branch, seconds]) => ({
        branch,
        hours: parseFloat((seconds / 3600).toFixed(2))
    })));

    const totalHours = Object.values(workspaceBranches).reduce((sum, seconds) => sum + seconds, 0) / 3600;

    panel.webview.html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <title>Branch Time Report</title>
        <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
        <style>
            body {
                font-family: "Segoe UI", Roboto, sans-serif;
                background: #fafafa;
                color: #333;
                padding: 20px;
                line-height: 1.6;
            }
            h2 {
                color: #2e3b4e;
                margin-bottom: 5px;
            }
            .workspace-info {
                background: #e8f4f8;
                padding: 10px;
                border-radius: 5px;
                margin-bottom: 20px;
                font-size: 14px;
            }
            .summary {
                background: #f0f8e8;
                padding: 15px;
                border-radius: 5px;
                margin-bottom: 20px;
            }
            table {
                border-collapse: collapse;
                width: 100%;
                margin-top: 20px;
                background: #fff;
                box-shadow: 0 1px 3px rgba(0,0,0,0.05);
            }
            th, td {
                padding: 10px 14px;
                border: 1px solid #ddd;
                text-align: left;
            }
            th {
                background-color: #f0f4f8;
                font-weight: 600;
            }
            tr:hover {
                background-color: #f9f9f9;
            }
            canvas {
                margin-top: 40px;
            }
        </style>
    </head>
    <body>
        <h2>🕒 Branch Time Report</h2>
        <div class="workspace-info">
            <strong>Workspace:</strong> ${currentWorkspace}<br>
            <strong>Generated:</strong> ${new Date().toLocaleString()}
        </div>
        
        <div class="summary">
            <strong>📊 Total Time Tracked:</strong> ${totalHours.toFixed(2)} hours<br>
            <strong>🌳 Branches Worked On:</strong> ${Object.keys(workspaceBranches).length}
        </div>

        <table>
            <tr><th>Branch Name</th><th>Time Spent</th><th>Hours (Decimal)</th></tr>
            ${tableRows}
        </table>

        <canvas id="timeChart" width="600" height="300"></canvas>

        <script>
            const ctx = document.getElementById('timeChart').getContext('2d');
            const data = ${chartData};

            new Chart(ctx, {
                type: 'bar',
                data: {
                    labels: data.map(d => d.branch),
                    datasets: [{
                        label: 'Hours Spent',
                        data: data.map(d => d.hours),
                        backgroundColor: 'rgba(34, 139, 34, 0.6)',
                        borderColor: 'rgba(34, 139, 34, 1)',
                        borderWidth: 1,
                        borderRadius: 4
                    }]
                },
                options: {
                    responsive: true,
                    scales: {
                        y: {
                            beginAtZero: true,
                            title: {
                                display: true,
                                text: 'Hours',
                                color: '#555',
                                font: { weight: 'bold' }
                            },
                            ticks: { color: '#444' }
                        },
                        x: {
                            title: {
                                display: true,
                                text: 'Git Branches',
                                color: '#555',
                                font: { weight: 'bold' }
                            },
                            ticks: {
                                color: '#444',
                                maxRotation: 45
                            }
                        }
                    },
                    plugins: {
                        legend: {
                            labels: { color: '#333' }
                        },
                        title: {
                            display: true,
                            text: 'Development Time by Git Branch',
                            color: '#2e3b4e',
                            font: { size: 16, weight: 'bold' }
                        }
                    }
                }
            });
        </script>
    </body>
    </html>
    `;
}

function startTrackingIfBranchFound() {
    const branch = getGitBranchName();
    
    if (branch) {
        if (branch === lastTrackedBranch && trackingStart) return;
        
        stopAndLogTime();
        currentBranch = branch;
        lastTrackedBranch = branch;
        trackingStart = Date.now();
        console.log(`🟢 Started tracking time for branch "${currentBranch}" in workspace "${currentWorkspace}"`);
        resetIdleTimer();
        
        // Save session data
        globalContext.globalState.update(STORAGE_KEYS.LAST_TRACKED_BRANCH, currentBranch);
        globalContext.globalState.update(STORAGE_KEYS.LAST_TRACKING_START, trackingStart);
        globalContext.globalState.update(STORAGE_KEYS.CURRENT_WORKSPACE, currentWorkspace);
    } else {
        console.log('⚠️ No Git branch found');
    }
}

function stopAndLogTime(isCleanExit = false) {
    if (!trackingStart || !currentBranch) return;

    const durationSec = Math.floor((Date.now() - trackingStart) / 1000);
    console.log(`🛑 Stopped tracking. Branch: "${currentBranch}", Duration: ${durationSec}s`);

    updateBranchTime(currentBranch, durationSec);

    const totalTime = getCurrentWorkspaceBranches()[currentBranch];
    console.log(`📊 Total time for branch "${currentBranch}": ${totalTime}s`);

    if (isCleanExit) {
        clearSessionData();
    }

    trackingStart = null;
    currentBranch = null;
    clearIdleTimer();
}

function resetIdleTimer() {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
        console.log('💤 User went idle, auto-stopping branch time tracker.');
        stopAndLogTime();
    }, 5 * 60 * 1000);
}

function clearIdleTimer() {
    if (idleTimer) clearTimeout(idleTimer);
}

function getGitBranchName(): string | null {
    const ws = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
    if (!ws) return null;

    const gitFolder = path.join(ws, '.git');
    if (!fs.existsSync(gitFolder)) {
        console.log('⛔ Not a Git repository, branch time tracking disabled');
        return null;
    }

    try {
        const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: ws })
            .toString()
            .trim();
        return branch;
    } catch {
        console.error('❌ Git error fetching current branch');
        return null;
    }
}

function exportTimeDataToFile() {
    try {
        const exportData = {
            workspace: currentWorkspace,
            exportDate: new Date().toISOString(),
            branches: getCurrentWorkspaceBranches(),
            totalHours: Object.values(getCurrentWorkspaceBranches()).reduce((sum, seconds) => sum + seconds, 0) / 3600
        };

        const fileName = `branch-time-export-${currentWorkspace}-${new Date().toISOString().split('T')[0]}.json`;
        const exportPath = path.join(os.homedir(), 'Downloads', fileName);
        
        fs.writeFileSync(exportPath, JSON.stringify(exportData, null, 2));
        vscode.window.showInformationMessage(`📁 Time data exported to: ${exportPath}`);
    } catch (err) {
        vscode.window.showErrorMessage(`❌ Export failed: ${err}`);
    }
}

function clearWorkspaceTimeData() {
    vscode.window.showWarningMessage(
        `🗑️ Clear all time data for workspace "${currentWorkspace}"?`,
        'Yes, Clear All', 'Cancel'
    ).then(selection => {
        if (selection === 'Yes, Clear All') {
            if (branchTimeMap[currentWorkspace]) {
                delete branchTimeMap[currentWorkspace];
                saveTrackedTimes();
                vscode.window.showInformationMessage('✅ Workspace time data cleared successfully.');
            }
        }
    });
}

export function deactivate() {
    console.log('🧹 Branch Time Tracker deactivating, cleaning up...');
    stopAndLogTime(true);
}