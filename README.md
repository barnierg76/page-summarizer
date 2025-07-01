# 🔊 Page Summarizer - Google Chrome Extension

A Google Chrome Extension for easy webpage summarization with text-to-speech (TTS). This accessibility-focused extension provides instant spoken summaries of any webpage, helping users quickly understand content through clear, natural-sounding audio.

> **Note**: This extension requires a [DAISYS.ai](https://speak.daisys.ai) account for text-to-speech functionality. Sign up for free to get started.

## What is Page Summarizer?

Page Summarizer is a Google Chrome Extension designed to make web content more accessible through audio summaries. With a single click or keyboard shortcut, it:

1. **Extracts** the main content from any webpage
2. **Summarizes** it using advanced AI (OpenAI, Anthropic, or xAI)
3. **Converts** the summary to natural speech using DAISYS.ai
4. **Plays** the audio automatically in a beautiful mini-player

Perfect for:
- 👁️ Visual accessibility needs
- 🎧 Audio learners
- ⏱️ Quick content consumption
- 🚗 Listening while multitasking
- 📚 Research and study

## Features

### 🎯 Core Features
- **One-click page summarization** - Summarizes webpage content in 1-2 paragraphs
- **Smart categorization** - Long pages are broken into digestible categories
- **Text explanation** - Select any difficult text and get a simplified explanation
- **Automatic audio playback** - Summaries start playing immediately
- **Beautiful audio player** - Modern, compact audio player window with visual feedback

### ⌨️ Keyboard Shortcuts (Customizable)
- `Ctrl+Shift+S` (Cmd+Shift+S on Mac) - Summarize current page
- `Ctrl+Shift+E` (Cmd+Shift+E on Mac) - Explain selected text

### 🤖 AI Integration
- Multiple LLM providers: OpenAI, Anthropic Claude, xAI Grok
- Custom API endpoint support
- Always outputs in English for consistency
- Optimized prompts for spoken content

### 🎙️ Text-to-Speech
- Natural-sounding DAISYS TTS voices (setup: speak.daisys.ai)
- WebSocket streaming for low latency
- Automatic fallback to standard generation
- Voice customization options

## Prerequisites

### Required Accounts

1. **DAISYS.ai Account** (Required for text-to-speech)
   - Sign up at https://speak.daisys.ai
   - DAISYS provides the natural-sounding voices that make this extension work
   - You'll need your DAISYS email and password for configuration
   - Free tier available with usage limits

2. **LLM API Key** (Required for AI summaries)
   - Choose one of:
     - OpenAI (https://platform.openai.com)
     - Anthropic Claude (https://console.anthropic.com)
     - xAI Grok (https://x.ai)
   - You'll need an API key from your chosen provider

## Installation

### From Source

1. Clone this repository:
   ```bash
   git clone https://github.com/daisys-ai/pagesummarizer.git
   cd pagesummarizer
   ```

2. Set up environment variables (optional):
   ```bash
   cp .env.example .env
   # Edit .env with your credentials (if running local server)
   ```

3. Install in Chrome:
   - Open Chrome and navigate to `chrome://extensions/`
   - Enable "Developer mode" in the top right
   - Click "Load unpacked"
   - Select the `pagesummarizer` folder

### Configuration

1. Click the extension icon and go to Settings
2. Configure your DAISYS account:
   - Enter your DAISYS.ai email and password
   - Select or generate a voice
3. Configure your AI provider:
   - Choose your LLM provider (OpenAI, Anthropic, xAI, or custom)
   - Enter your API key
   - Select the model

## Usage

### Summarizing Pages
1. Navigate to any webpage
2. Click the extension icon and press "Summarize This Page" OR
3. Use the keyboard shortcut `Ctrl+Shift+S`
4. Audio will automatically start playing in a separate window

### Explaining Text
1. Select any text on a webpage
2. Press `Ctrl+Shift+E`
3. Get a simplified explanation in audio format

### Customizing Shortcuts
1. Go to Settings → Keyboard Shortcuts
2. Click "Customize Shortcuts"
3. Set your preferred key combinations

## Technical Details

### Architecture
- **Manifest V3** Chrome extension
- **Service Worker** for background processing
- **Content Script** for webpage interaction
- **WebSocket streaming** for real-time audio
- **Separate audio player window** for persistent playback

### Project Structure
```
page-summarizer/
├── manifest.json           # Extension configuration
├── background.js          # Service worker
├── popup.html/js/css      # Extension popup UI
├── content.js             # Content script
├── audio_player.html/js   # Audio player window
├── websocket_*.js         # WebSocket handling
├── daisys_*.js           # DAISYS API integration
└── CLAUDE.md             # Development notes
```

### Security
- API keys stored locally in Chrome storage
- No external data collection
- All processing through configured APIs
- `.env` files excluded from repository

## Development

### Prerequisites
- Chrome browser
- DAISYS.ai account (https://speak.daisys.ai)
- LLM API key (OpenAI, Anthropic, or xAI)

### API Requirements
- **DAISYS.ai API**: Essential for text-to-speech functionality
  - Sign up at https://speak.daisys.ai
  - Provides natural, expressive voices
  - WebSocket streaming support for low latency
- **LLM API**: For content summarization and explanation
  - OpenAI: GPT-3.5-turbo or GPT-4
  - Anthropic: Claude 3 Haiku/Sonnet/Opus
  - xAI: Grok 2

### Building from Source
No build process required - the extension runs directly from source files.

## Troubleshooting

### Audio Not Playing
- Check DAISYS credentials in settings
- Ensure you have selected a voice
- Check browser console for WebSocket errors
- Try the fallback mode (will use standard generation)

### Summaries Not Generating
- Verify LLM API key is valid
- Check API rate limits
- Ensure webpage has sufficient content
- Check browser console for API errors

### Keyboard Shortcuts Not Working
- Check for conflicts with other extensions
- Customize shortcuts via Settings
- Ensure the webpage is not blocking keyboard events

## Privacy

- All API calls are made directly from your browser
- No data is sent to third-party servers (except configured APIs)
- API keys are stored locally and never transmitted
- No analytics or tracking

## License

This project is licensed under the **MIT License with Non-Commercial Restriction**.

- ✅ Free to use for personal projects
- ✅ Free to use for educational purposes
- ✅ Free to modify and distribute
- ❌ **Cannot be used for commercial purposes**
- ✅ Contributions welcome!

See the [LICENSE](LICENSE) file for full details. For commercial licensing, please contact DAISYS AI.

## Contributing

We welcome contributions! Please see our [Contributing Guidelines](CONTRIBUTING.md) for details.

- 🐛 Report bugs
- 💡 Suggest features
- 🔧 Submit pull requests
- 📚 Improve documentation

Remember: All contributions must respect the non-commercial license.

## Community

- Follow our [Code of Conduct](CODE_OF_CONDUCT.md)
- Be respectful and inclusive
- Help others learn and grow

## Support

For issues or questions:
- Check the troubleshooting section
- Review browser console for errors
- Ensure API keys are valid and have credits
- Open an issue on GitHub

## Acknowledgments

- DAISYS for providing natural TTS voices
- OpenAI, Anthropic, and xAI for LLM APIs
- Chrome Extensions team for Manifest V3 documentation
