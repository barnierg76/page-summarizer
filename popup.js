// Popup script for Page Summarizer

// Current summary state
let currentSummary = '';

document.addEventListener('DOMContentLoaded', () => {
    // Load saved settings
    loadSettings();
    
    // Tab switching
    const tabButtons = document.querySelectorAll('.tab-button');
    tabButtons.forEach(button => {
        button.addEventListener('click', () => {
            const targetTab = button.dataset.tab;
            switchTab(targetTab);
        });
    });
    
    // Summarize button
    const summarizeBtn = document.getElementById('summarize-btn');
    summarizeBtn.addEventListener('click', handleGetSummary);
    
    // Stop button
    const stopBtn = document.getElementById('stop-btn');
    const audioPlayer = document.getElementById('audio-player');
    
    stopBtn.addEventListener('click', async () => {
        // Tell background to stop streaming
        await chrome.runtime.sendMessage({ action: 'stopStreaming' });
        
        stopBtn.classList.add('hidden');
        
        const statusDiv = document.getElementById('status');
        statusDiv.textContent = 'Summary stopped';
    });
    
    // Settings form
    const settingsForm = document.getElementById('settings-form');
    settingsForm.addEventListener('submit', handleSaveSettings);
    
    // LLM provider change
    const llmProvider = document.getElementById('llm-provider');
    llmProvider.addEventListener('change', () => {
        const endpointGroup = document.getElementById('llm-endpoint-group');
        if (llmProvider.value === 'custom') {
            endpointGroup.style.display = 'block';
        } else {
            endpointGroup.style.display = 'none';
        }
        updateModelOptions();
    });
    
    // Test DAISYS connection when credentials change
    const daisysEmail = document.getElementById('daisys-email');
    const daisysPassword = document.getElementById('daisys-password');
    
    let daisysTestTimeout;
    const debouncedTestDaisys = () => {
        clearTimeout(daisysTestTimeout);
        daisysTestTimeout = setTimeout(() => {
            if (daisysEmail.value && daisysPassword.value) {
                testDaisysConnection();
                loadDaisysModels();
            }
        }, 1000);
    };
    
    daisysEmail.addEventListener('input', debouncedTestDaisys);
    daisysPassword.addEventListener('input', debouncedTestDaisys);
    
    // Voice generation
    const generateVoiceBtn = document.getElementById('generate-voice-btn');
    generateVoiceBtn.addEventListener('click', handleGenerateVoice);
    
    // Keyboard shortcuts button
    const openShortcutsBtn = document.getElementById('open-shortcuts');
    openShortcutsBtn.addEventListener('click', () => {
        chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
    });
    
    // Load and display current shortcuts
    loadShortcuts();
});

function switchTab(tabName) {
    // Update tab buttons
    document.querySelectorAll('.tab-button').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tabName);
    });
    
    // Update tab content
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.toggle('active', content.id === `${tabName}-tab`);
    });
}

async function loadSettings() {
    try {
        const settings = await chrome.storage.local.get([
            'daisysEmail', 'daisysPassword', 'selectedVoiceId',
            'llmProvider', 'llmApiKey', 'llmEndpoint', 'llmModel', 'outputLanguage', 'enableSSML'
        ]);
        
        // Load DAISYS settings
        if (settings.daisysEmail) {
            document.getElementById('daisys-email').value = settings.daisysEmail;
        }
        if (settings.daisysPassword) {
            document.getElementById('daisys-password').value = settings.daisysPassword;
        }
        
        // Load LLM settings
        if (settings.llmProvider) {
            document.getElementById('llm-provider').value = settings.llmProvider;
        }
        if (settings.llmApiKey) {
            document.getElementById('llm-api-key').value = settings.llmApiKey;
        }
        if (settings.llmEndpoint) {
            document.getElementById('llm-endpoint').value = settings.llmEndpoint;
        }
        if (settings.llmModel) {
            document.getElementById('llm-model').value = settings.llmModel;
        }
        if (settings.outputLanguage) {
            document.getElementById('output-language').value = settings.outputLanguage;
        }
        
        // Load SSML setting (default to true if not set)
        document.getElementById('enable-ssml').checked = settings.enableSSML !== false;
        
        // Update UI based on provider
        const llmProvider = document.getElementById('llm-provider');
        const endpointGroup = document.getElementById('llm-endpoint-group');
        if (llmProvider.value === 'custom') {
            endpointGroup.style.display = 'block';
        }
        
        updateModelOptions();
        
        // Test DAISYS connection if credentials exist
        if (settings.daisysEmail && settings.daisysPassword) {
            await testDaisysConnection();
            await loadDaisysModels();
            if (settings.selectedVoiceId) {
                document.getElementById('daisys-voice').value = settings.selectedVoiceId;
            }
        }
        
    } catch (error) {
        console.error('Error loading settings:', error);
    }
}

async function handleGetSummary() {
    const btn = document.getElementById('summarize-btn');
    const statusDiv = document.getElementById('status');
    const errorDiv = document.getElementById('error-message');
    
    try {
        // Reset UI
        btn.disabled = true;
        btn.classList.add('loading');
        statusDiv.textContent = 'Analyzing page content...';
        errorDiv.classList.add('hidden');
        
        // Get active tab
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        
        if (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) {
            throw new Error("Cannot summarize browser pages");
        }
        
        // Inject content script with retry logic
        try {
            await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                files: ['content.js']
            });
        } catch (e) {
            // Script might already be injected, try to proceed
            console.log('Content script injection warning:', e);
        }
        
        // Wait a bit for script to load
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // Extract content with retry
        let response;
        let retries = 3;
        while (retries > 0) {
            try {
                response = await chrome.tabs.sendMessage(tab.id, { action: 'extractContent' });
                break;
            } catch (e) {
                retries--;
                if (retries === 0) throw new Error('Failed to communicate with page. Please refresh and try again.');
                await new Promise(resolve => setTimeout(resolve, 200));
            }
        }
        
        if (!response || !response.content) {
            throw new Error('Failed to extract page content');
        }
        
        // Get saved settings
        const settings = await chrome.storage.local.get([
            'llmProvider', 'llmApiKey', 'llmEndpoint', 'llmModel', 'outputLanguage'
        ]);
        
        if (!settings.llmProvider || !settings.llmApiKey) {
            throw new Error('Please configure AI settings first');
        }
        
        // Generate summary
        statusDiv.textContent = 'Creating summary...';
        
        const summaryResponse = await chrome.runtime.sendMessage({
            action: 'generateSummary',
            content: response.content,
            settings: settings
        });
        
        if (summaryResponse.error) {
            throw new Error(summaryResponse.error);
        }
        
        // Store summary (but don't display it)
        currentSummary = summaryResponse.summary;
        statusDiv.textContent = 'Summary ready, starting audio...';
        
        // Automatically start playing audio
        await handlePlayAudioStream();
        
    } catch (error) {
        console.error('Summary error:', error);
        errorDiv.textContent = error.message;
        errorDiv.classList.remove('hidden');
        statusDiv.textContent = 'Summary failed';
    } finally {
        btn.disabled = false;
        btn.classList.remove('loading');
    }
}

async function handlePlayAudioStream() {
    const stopBtn = document.getElementById('stop-btn');
    const statusDiv = document.getElementById('status');
    const errorDiv = document.getElementById('error-message');
    const audioPlayer = document.getElementById('audio-player');
    
    try {
        errorDiv.classList.add('hidden');
        
        // Get saved settings
        const settings = await chrome.storage.local.get([
            'daisysEmail', 'daisysPassword', 'selectedVoiceId'
        ]);
        
        if (!settings.daisysEmail || !settings.daisysPassword || !settings.selectedVoiceId) {
            throw new Error('Please configure voice settings first');
        }
        
        // Get current tab ID
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        
        // Open audio player window first
        await chrome.runtime.sendMessage({
            action: 'openAudioPlayer',
            mode: 'streaming'
        });
        
        // Try streaming first (will automatically fall back to regular)
        try {
            console.log('[Popup] Attempting streaming playback...');
            
            const streamResponse = await chrome.runtime.sendMessage({
                action: 'generateSpeechStream',
                text: currentSummary,
                settings: settings,
                tabId: tab.id
            });
            
            console.log('[Popup] Stream response received:', streamResponse);
            
            if (streamResponse.error) {
                // Check if it's a WebSocket availability error
                console.log('[Popup] Stream response error:', streamResponse.error);
                if (streamResponse.error.includes('WebSocket') ||
                    streamResponse.error.includes('streaming') || 
                    streamResponse.error.includes('404') ||
                    streamResponse.error.includes('fallback') ||
                    streamResponse.error.includes('unavailable')) {
                    console.log('[Popup] WebSocket not available, using regular generation');
                    throw new Error('websocket-unavailable');
                }
                throw new Error(streamResponse.error);
            }
            
            // If we got a success response, audio will play in the audio player window
            if (streamResponse.success) {
                statusDiv.textContent = 'Playing summary in audio window...';
            } else {
                throw new Error('Streaming setup failed');
            }
            
        } catch (streamError) {
            // Fallback to regular generation
            console.log('[Popup] Stream error caught:', streamError.message);
            if (streamError.message === 'websocket-unavailable' || 
                streamError.message.toLowerCase().includes('websocket') ||
                streamError.message.toLowerCase().includes('streaming') || 
                streamError.message.includes('fallback') ||
                streamError.message.includes('unavailable') ||
                streamError.message.includes('404')) {
                
                console.log('Falling back to regular speech generation');
                statusDiv.textContent = 'Generating audio...';
                
                try {
                    const speechResponse = await chrome.runtime.sendMessage({
                        action: 'generateSpeech',
                        text: currentSummary,
                        settings: settings
                    });
                    
                    if (speechResponse.error) {
                        throw new Error(speechResponse.error);
                    }
                    
                    // Open audio player window with URL
                    await chrome.runtime.sendMessage({
                        action: 'openAudioPlayer',
                        mode: 'url',
                        audioUrl: speechResponse.audioUrl
                    });
                    
                    statusDiv.textContent = 'Playing summary in audio window...';
                } catch (fallbackError) {
                    throw fallbackError;
                }
            } else {
                throw streamError;
            }
        }
        
    } catch (error) {
        console.error('Speech generation error:', error);
        errorDiv.textContent = error.message;
        errorDiv.classList.remove('hidden');
        statusDiv.textContent = 'Audio generation failed';
    }
}


async function handleSaveSettings(event) {
    event.preventDefault();
    
    const statusDiv = document.getElementById('settings-status');
    statusDiv.textContent = 'Saving settings...';
    statusDiv.className = 'status-message';
    
    try {
        const settings = {
            daisysEmail: document.getElementById('daisys-email').value,
            daisysPassword: document.getElementById('daisys-password').value,
            selectedVoiceId: document.getElementById('daisys-voice').value,
            llmProvider: document.getElementById('llm-provider').value,
            llmApiKey: document.getElementById('llm-api-key').value,
            llmEndpoint: document.getElementById('llm-endpoint').value,
            llmModel: document.getElementById('llm-model').value,
            outputLanguage: document.getElementById('output-language').value,
            enableSSML: document.getElementById('enable-ssml').checked
        };
        
        await chrome.storage.local.set(settings);
        
        statusDiv.textContent = 'Settings saved successfully!';
        statusDiv.className = 'status-message success';
        
        // Switch back to main tab after successful save
        setTimeout(() => {
            switchTab('summary');
        }, 1000);
        
    } catch (error) {
        console.error('Settings save error:', error);
        statusDiv.textContent = `Error: ${error.message}`;
        statusDiv.className = 'status-message error';
    }
}

async function testDaisysConnection() {
    const voiceSelect = document.getElementById('daisys-voice');
    const email = document.getElementById('daisys-email').value;
    const password = document.getElementById('daisys-password').value;
    
    if (!email || !password) {
        return;
    }
    
    try {
        voiceSelect.innerHTML = '<option value="">Loading voices...</option>';
        
        const response = await chrome.runtime.sendMessage({
            action: 'testDaisysConnection',
            settings: { daisysEmail: email, daisysPassword: password }
        });
        
        if (response.error) {
            throw new Error(response.error);
        }
        
        if (response.voices && response.voices.length > 0) {
            voiceSelect.innerHTML = '';
            response.voices.forEach(voice => {
                const option = document.createElement('option');
                option.value = voice.id;
                option.textContent = `${voice.name} (${voice.gender})`;
                voiceSelect.appendChild(option);
            });
        } else {
            voiceSelect.innerHTML = '<option value="">No voices available</option>';
        }
    } catch (error) {
        console.error('DAISYS connection error:', error);
        voiceSelect.innerHTML = '<option value="">Error loading voices</option>';
    }
}

async function handleGenerateVoice() {
    const generateBtn = document.getElementById('generate-voice-btn');
    const statusDiv = document.getElementById('voice-generation-status');
    const email = document.getElementById('daisys-email').value;
    const password = document.getElementById('daisys-password').value;
    const gender = document.getElementById('voice-gender').value;
    const model = document.getElementById('voice-model').value;
    
    if (!email || !password) {
        statusDiv.textContent = 'Please enter DAISYS credentials first';
        statusDiv.className = 'status-message error';
        return;
    }
    
    if (!model) {
        statusDiv.textContent = 'Please select a voice model';
        statusDiv.className = 'status-message error';
        return;
    }
    
    try {
        generateBtn.disabled = true;
        statusDiv.textContent = 'Generating new voice...';
        statusDiv.className = 'status-message';
        
        // Generate a friendly name for accessibility voices
        const voiceNames = {
            female: ['Clear Voice', 'Friendly Assistant', 'Helpful Guide', 'Easy Reader'],
            male: ['Clear Speaker', 'Friendly Helper', 'Easy Guide', 'Clear Reader'],
            nonbinary: ['Clear Assistant', 'Friendly Voice', 'Easy Helper', 'Clear Guide']
        };
        
        const namePool = voiceNames[gender] || voiceNames.nonbinary;
        const voiceName = namePool[Math.floor(Math.random() * namePool.length)] + ' ' + Date.now().toString().slice(-4);
        
        const response = await chrome.runtime.sendMessage({
            action: 'generateVoice',
            voiceData: {
                name: voiceName,
                gender: gender,
                model: model
            },
            settings: { 
                daisysEmail: email, 
                daisysPassword: password 
            }
        });
        
        if (response.error) {
            throw new Error(response.error);
        }
        
        statusDiv.textContent = `Voice "${voiceName}" created!`;
        statusDiv.className = 'status-message success';
        
        // Refresh voice list
        await testDaisysConnection();
        
        // Select the new voice
        document.getElementById('daisys-voice').value = response.voice.id;
        
    } catch (error) {
        console.error('Voice generation error:', error);
        statusDiv.textContent = `Error: ${error.message}`;
        statusDiv.className = 'status-message error';
    } finally {
        generateBtn.disabled = false;
    }
}

function updateModelOptions() {
    const provider = document.getElementById('llm-provider').value;
    const modelSelect = document.getElementById('llm-model');
    
    const models = {
        openai: [
            { value: 'gpt-3.5-turbo', text: 'GPT-3.5 Turbo' },
            { value: 'gpt-4', text: 'GPT-4' },
            { value: 'gpt-4-turbo-preview', text: 'GPT-4 Turbo' }
        ],
        anthropic: [
            { value: 'claude-3-haiku-20240307', text: 'Claude 3 Haiku' },
            { value: 'claude-3-sonnet-20240229', text: 'Claude 3 Sonnet' },
            { value: 'claude-3-opus-20240229', text: 'Claude 3 Opus' }
        ],
        xai: [
            { value: 'grok-2-1212', text: 'Grok 2' },
            { value: 'grok-2-vision-1212', text: 'Grok 2 Vision' }
        ],
        custom: [
            { value: 'custom', text: 'Custom Model' }
        ]
    };
    
    modelSelect.innerHTML = '';
    const providerModels = models[provider] || models.custom;
    
    providerModels.forEach(model => {
        const option = document.createElement('option');
        option.value = model.value;
        option.textContent = model.text;
        modelSelect.appendChild(option);
    });
}

async function loadDaisysModels() {
    const modelSelect = document.getElementById('voice-model');
    const email = document.getElementById('daisys-email').value;
    const password = document.getElementById('daisys-password').value;
    
    if (!email || !password) {
        modelSelect.innerHTML = '<option value="">Enter credentials first</option>';
        return;
    }
    
    try {
        modelSelect.innerHTML = '<option value="">Loading models...</option>';
        
        const response = await chrome.runtime.sendMessage({
            action: 'getModels',
            settings: { daisysEmail: email, daisysPassword: password }
        });
        
        if (response.error) {
            throw new Error(response.error);
        }
        
        if (response.models && response.models.length > 0) {
            modelSelect.innerHTML = '';
            response.models.forEach(model => {
                const option = document.createElement('option');
                option.value = model.name;
                option.textContent = model.displayName || model.name;
                modelSelect.appendChild(option);
            });
        } else {
            modelSelect.innerHTML = '<option value="">No models available</option>';
        }
    } catch (error) {
        console.error('Load models error:', error);
        modelSelect.innerHTML = '<option value="">Error loading models</option>';
    }
}

async function loadShortcuts() {
    try {
        // Get all commands for this extension
        const commands = await chrome.commands.getAll();
        
        commands.forEach(command => {
            let displayElement = null;
            let displayText = command.shortcut || 'Not set';
            
            // Format shortcut for display (make it OS-appropriate)
            if (navigator.platform.includes('Mac')) {
                displayText = displayText.replace('Ctrl', 'Cmd');
            }
            
            if (command.name === 'summarize-page') {
                displayElement = document.getElementById('summarize-shortcut');
                // Also update the shortcut display in the main tab
                const mainShortcut = document.getElementById('main-summarize-shortcut');
                if (mainShortcut) {
                    mainShortcut.textContent = displayText;
                }
            } else if (command.name === 'explain-selection') {
                displayElement = document.getElementById('explain-shortcut');
                // Also update the shortcut display in the main tab
                const mainShortcut = document.getElementById('main-explain-shortcut');
                if (mainShortcut) {
                    mainShortcut.textContent = displayText;
                }
            }
            
            if (displayElement) {
                displayElement.textContent = displayText;
            }
        });
    } catch (error) {
        console.error('Error loading shortcuts:', error);
    }
}