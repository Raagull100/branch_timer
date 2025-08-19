# 🕒 Branch Time Tracker

A VS Code extension that automatically tracks how much time you spend working on different Git branches. Perfect for developers who want to understand their coding patterns, track project time, or analyze productivity across different features.

## ✨ Features

- **Automatic Time Tracking**: Starts tracking when you switch branches or begin coding
- **Smart Session Management**: Resumes tracking after VS Code restarts (within 10 minutes)
- **Idle Detection**: Automatically stops tracking after 5 minutes of inactivity
- **Beautiful Reports**: View detailed time reports with interactive charts
- **Data Export**: Export your time data to JSON files
- **Per-Workspace Tracking**: Separate time tracking for each project/workspace
- **Zero Configuration**: Works out of the box with any Git repository

<!-- ## 📦 Installation

1. Open VS Code
2. Go to Extensions (`Ctrl+Shift+X` or `Cmd+Shift+X`)
3. Search for "Branch Time Tracker"
4. Click "Install" -->

<!-- Or install via command line:
```bash
code --install-extension your-publisher-name.branch-time-tracker
``` -->

## 🚀 Getting Started

1. **Open a Git Repository**: The extension only works in folders that contain a `.git` directory
2. **Start Coding**: Time tracking begins automatically when you:
   - Edit files
   - Switch between files
   - Focus the VS Code window
3. **View Your Time**: Use the command palette or extension commands to see your tracked time

## 📋 Commands

Access these commands via the Command Palette (`Ctrl+Shift+P` or `Cmd+Shift+P`):

| Command | Description |
|---------|-------------|
| `Branch Timer: Start Tracking` | Manually start time tracking for current branch |
| `Branch Timer: Show Total Time` | Quick view of time spent on each branch |
| `Branch Timer: View Time Report` | Open detailed report with charts |
| `Branch Timer: Export Time Data` | Export data to JSON file in Downloads folder |
| `Branch Timer: Clear Time Data` | Clear all tracked time for current workspace |

## 📊 Understanding Your Data

### Quick Summary
```
Branch Time Summary (MyProject_a1b2c3d4):
main: 5h 23m 45s
feature/user-auth: 3h 12m 30s
bugfix/login-issue: 1h 45m 12s
```

### Detailed Report
The visual report includes:
- **Bar Chart**: Compare time across branches
- **Detailed Table**: Exact time breakdown
- **Summary Stats**: Total hours and branch count
- **Export Options**: Save data for external analysis

## ⚙️ How It Works

### Automatic Tracking
- **Starts When**: You edit code, switch files, or focus VS Code
- **Stops When**: You go idle (5+ minutes), unfocus VS Code, or close the editor
- **Branch Detection**: Automatically detects current Git branch using `git rev-parse`

### Data Storage
- All data is stored in VS Code's global storage (survives updates)
- No local files created (keeps your workspace clean)
- Per-workspace tracking prevents data mixing between projects

### Session Recovery
- If VS Code crashes or restarts, tracking resumes automatically
- If you restart VS Code within 10 minutes, it continues tracking. After 10 minutes, it starts fresh to avoid counting break time.
- Saves tracking state every time you switch branches

## 📁 Data Export Format

Exported JSON files include:
```json
{
  "workspace": "MyProject_a1b2c3d4",
  "exportDate": "2024-01-15T10:30:00.000Z",
  "totalHours": 12.75,
  "branches": {
    "main": 19425,
    "feature/user-auth": 11550,
    "bugfix/login-issue": 6312
  }
}
```

## 🔧 Requirements

- **VS Code**: Version 1.60.0 or higher
- **Git**: Must be installed and accessible from command line
- **Git Repository**: Extension only works in folders with `.git` directory

## 💡 Tips & Best Practices

### Maximize Accuracy
- Keep VS Code focused while coding (unfocusing stops tracking)
- The extension detects typing, so it works even if you don't save files
- Switch branches frequently to get accurate per-feature time tracking

### Understanding Workspaces
- Each workspace gets a unique ID based on folder path
- Moving a project folder creates a new workspace ID
- Use consistent project locations for best tracking continuity

### Data Management
- Export data regularly for backup
- Clear old workspace data to keep storage clean
- Check reports weekly to understand your coding patterns

## 🐛 Troubleshooting

### "No Git branch found"
- Ensure you're in a Git repository (`ls -la` should show `.git` folder)
- Run `git status` to verify Git is working
- Make sure you're on a branch (not in detached HEAD state)

### Tracking Not Starting
- Check that you're in a workspace folder (not just individual files)
- Verify Git is installed and accessible: `git --version`
- Try the "Start Tracking" command manually

### Data Not Persisting
- Data is stored globally, not in your project folder
- If switching VS Code versions, data might be in different storage locations
- Export important data before major VS Code updates

### Time Seems Inaccurate
- Idle timeout is 5 minutes - longer breaks stop tracking
- Unfocusing VS Code stops tracking immediately
- Only active coding time is tracked, not thinking/planning time

## 🤝 Contributing

Found a bug or have a feature request? We'd love to hear from you!

1. **Issues**: Report bugs or request features on my GitHub issues page
2. **Pull Requests**: Contributions are welcome!
3. **Feedback**: Use VS Code's extension rating system to share your experience

<!-- ## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details. -->

## 🙏 Acknowledgments

- Built with VS Code Extension API
- Uses Chart.js for beautiful time visualizations
- Inspired by the need for better developer productivity insights

---

**Happy Coding! 🚀**

*Track your time, understand your patterns, and code more effectively with Branch Time Tracker.*
