// Background service worker for Page Summarizer

// Load bundled WebSocket classes, MCP adapter, and SSML processor (avoiding ES6 imports in service worker)
try {
    self.importScripts('websocket-bundle.js');
    self.importScripts('mcp-adapter-bundle.js');
    self.importScripts('ssml_processor.js');
} catch (e) {
    console.error('Failed to load bundles:', e);
}

// Store for WebSocket connections
const wsConnections = new Map();

// MCP Adapter instance
let mcpAdapter = null;

// Audio streaming state
// Note: Audio processing happens in popup, not in service worker
let isStreamingActive = false;

// Global reference to audio player window
let audioPlayerWindow = null;
let audioPlayerWindowOpening = false;

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'generateSummary') {
        handleGenerateSummary(request.content, request.settings)
            .then(sendResponse)
            .catch(error => sendResponse({ error: error.message }));
        return true;
    } else if (request.action === 'explainText') {
        handleExplainText(request.text, request.settings)
            .then(sendResponse)
            .catch(error => sendResponse({ error: error.message }));
        return true;
    } else if (request.action === 'generateSpeech') {
        handleSpeechGeneration(request.text, request.settings)
            .then(sendResponse)
            .catch(error => sendResponse({ error: error.message }));
        return true;
    } else if (request.action === 'generateSpeechStream') {
        handleStreamingSpeech(request.text, request.settings, request.tabId)
            .then(sendResponse)
            .catch(error => sendResponse({ error: error.message }));
        return true;
    } else if (request.action === 'stopStreaming') {
        stopStreamingAudio();
        sendResponse({ success: true });
        return true;
    } else if (request.action === 'testDaisysConnection') {
        testDaisysAPIWithMCP(request.settings)
            .then(sendResponse)
            .catch(error => sendResponse({ error: error.message }));
        return true;
    } else if (request.action === 'generateVoice') {
        handleVoiceGenerationWithMCP(request.voiceData, request.settings)
            .then(sendResponse)
            .catch(error => sendResponse({ error: error.message }));
        return true;
    } else if (request.action === 'getModels') {
        getDaisysModelsWithMCP(request.settings)
            .then(sendResponse)
            .catch(error => sendResponse({ error: error.message }));
        return true;
    } else if (request.action === 'openAudioPlayer') {
        openAudioPlayerWindow(request.mode, request.audioUrl)
            .then(sendResponse)
            .catch(error => sendResponse({ error: error.message }));
        return true;
    }
});

// Open or focus audio player window
async function openAudioPlayerWindow(mode = 'streaming', audioUrl = null) {
    // Prevent rapid window creation attempts
    if (audioPlayerWindowOpening) {
        console.log('Audio player window is already being opened');
        return { success: false, error: 'Window operation in progress' };
    }
    
    audioPlayerWindowOpening = true;
    
    try {
        // Check if window already exists
        if (audioPlayerWindow) {
            try {
                // Get window info to check if it still exists
                const window = await chrome.windows.get(audioPlayerWindow);
                
                // Window exists, focus it and send new audio
                await chrome.windows.update(audioPlayerWindow, { focused: true });
                
                // Get all tabs in the window
                const tabs = await chrome.tabs.query({ windowId: audioPlayerWindow });
                if (tabs.length > 0) {
                    // Stop current audio first
                    try {
                        await chrome.tabs.sendMessage(tabs[0].id, {
                            action: 'stopAudio'
                        });
                    } catch (err) {
                        console.log('Error stopping audio:', err);
                    }
                    
                    // Small delay to ensure audio is stopped
                    await new Promise(resolve => setTimeout(resolve, 200));
                    
                    // Update the URL with new parameters
                    const newUrl = chrome.runtime.getURL(`audio_player.html?mode=${mode}${audioUrl ? `&url=${encodeURIComponent(audioUrl)}` : ''}`);
                    await chrome.tabs.update(tabs[0].id, { url: newUrl });
                }
                
                audioPlayerWindowOpening = false;
                return { success: true, windowId: audioPlayerWindow };
            } catch (e) {
                // Window doesn't exist anymore, clear reference
                console.log('Window no longer exists, clearing reference');
                audioPlayerWindow = null;
            }
        }
        
        // Create new window
        const params = {
            url: chrome.runtime.getURL(`audio_player.html?mode=${mode}${audioUrl ? `&url=${encodeURIComponent(audioUrl)}` : ''}`),
            type: 'popup',
            width: 340,
            height: 180,
            top: 100,
            left: 100
        };
        
        const window = await chrome.windows.create(params);
        audioPlayerWindow = window.id;
        
        // Listen for window close
        chrome.windows.onRemoved.addListener(function windowCloseListener(windowId) {
            if (windowId === audioPlayerWindow) {
                audioPlayerWindow = null;
                chrome.windows.onRemoved.removeListener(windowCloseListener);
            }
        });
        
        return { success: true, windowId: audioPlayerWindow };
    } catch (error) {
        console.error('Error opening audio player window:', error);
        throw error;
    } finally {
        // Always reset the flag
        audioPlayerWindowOpening = false;
    }
}

// Get or create MCP adapter instance
async function getMCPAdapter(settings) {
    if (!mcpAdapter) {
        mcpAdapter = new DaisysMCPAdapter();
    }
    
    // Ensure adapter is initialized
    if (!mcpAdapter.authToken) {
        if (!settings || !settings.daisysEmail || !settings.daisysPassword) {
            throw new Error('DAISYS credentials not provided');
        }
        await mcpAdapter.initialize(settings.daisysEmail, settings.daisysPassword);
    }
    
    return mcpAdapter;
}

// Stop streaming audio
function stopStreamingAudio() {
    isStreamingActive = false;
    
    // Close any open websockets
    wsConnections.forEach(connection => {
        if (connection.connector) {
            connection.connector.close();
        }
    });
    wsConnections.clear();
}

// Listen for keyboard shortcuts
chrome.commands.onCommand.addListener(async (command) => {
    if (command === 'summarize-page') {
        await handleHotkeySummarizePage();
    } else if (command === 'explain-selection') {
        await handleHotkeyExplainSelection();
    }
});

// Handle hotkey for page summarization
async function handleHotkeySummarizePage() {
    try {
        // Get active tab
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        
        if (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) {
            console.error('Cannot summarize browser internal pages');
            return;
        }
        
        // Get saved settings
        const settings = await chrome.storage.local.get([
            'daisysEmail', 'daisysPassword', 'selectedVoiceId',
            'llmProvider', 'llmApiKey', 'llmEndpoint', 'llmModel', 'outputLanguage'
        ]);
        
        if (!settings.llmProvider || !settings.llmApiKey) {
            console.error('Please configure LLM settings first');
            return;
        }
        
        if (!settings.daisysEmail || !settings.daisysPassword || !settings.selectedVoiceId) {
            console.error('Please configure DAISYS settings first');
            return;
        }
        
        // Inject content script
        await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['content.js']
        });
        
        // Wait a bit for script to load
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // Extract content
        const contentResponse = await chrome.tabs.sendMessage(tab.id, { action: 'extractContent' });
        
        if (!contentResponse || !contentResponse.content) {
            console.error('Failed to extract page content');
            return;
        }
        
        // Generate summary
        const summaryResult = await handleGenerateSummary(contentResponse.content, settings);
        
        if (!summaryResult.summary) {
            console.error('Failed to generate summary');
            return;
        }
        
        // Try streaming speech first
        try {
            console.log('[Background] Attempting streaming speech...');
            
            // Open audio player window for hotkey usage
            await openAudioPlayerWindow('streaming');
            
            await handleStreamingSpeech(summaryResult.summary, settings, tab.id);
        } catch (streamError) {
            console.log('[Background] Streaming failed, trying regular generation:', streamError.message);
            
            // Notify user about fallback
            chrome.notifications.create({
                type: 'basic',
                iconUrl: 'icon48.png',
                title: 'Switching to Standard Mode',
                message: 'Streaming unavailable, generating full audio...'
            });
            
            // Fallback to regular generation
            try {
                const result = await handleSpeechGeneration(summaryResult.summary, settings);
                
                // Open audio player window with URL
                await openAudioPlayerWindow('url', result.audioUrl);
            } catch (fallbackError) {
                console.error('Both streaming and regular generation failed:', fallbackError);
                chrome.notifications.create({
                    type: 'basic',
                    iconUrl: 'icon48.png',
                    title: 'Summary Error',
                    message: 'Failed to generate audio. Please check your settings.'
                });
            }
        }
        
    } catch (error) {
        console.error('Hotkey summary error:', error);
        chrome.notifications.create({
            type: 'basic',
            iconUrl: 'icon48.png',
            title: 'Summary Error',
            message: error.message || 'Failed to generate summary'
        });
    }
}

// Handle hotkey for text explanation
async function handleHotkeyExplainSelection() {
    try {
        // Get active tab
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        
        if (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) {
            console.error('Cannot explain text on browser internal pages');
            return;
        }
        
        // Get saved settings
        const settings = await chrome.storage.local.get([
            'daisysEmail', 'daisysPassword', 'selectedVoiceId',
            'llmProvider', 'llmApiKey', 'llmEndpoint', 'llmModel', 'outputLanguage'
        ]);
        
        if (!settings.llmProvider || !settings.llmApiKey) {
            console.error('Please configure LLM settings first');
            return;
        }
        
        if (!settings.daisysEmail || !settings.daisysPassword || !settings.selectedVoiceId) {
            console.error('Please configure DAISYS settings first');
            return;
        }
        
        // Inject content script
        await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['content.js']
        });
        
        // Wait a bit for script to load
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // Get selected text
        const selectionResponse = await chrome.tabs.sendMessage(tab.id, { action: 'getSelectedText' });
        
        if (!selectionResponse || !selectionResponse.selectedText) {
            chrome.notifications.create({
                type: 'basic',
                iconUrl: 'icon48.png',
                title: 'No Text Selected',
                message: 'Please select some text first, then try again.'
            });
            return;
        }
        
        // Generate explanation
        const explanationResult = await handleExplainText(selectionResponse.selectedText, settings);
        
        if (!explanationResult.explanation) {
            console.error('Failed to generate explanation');
            return;
        }
        
        // Try streaming speech
        try {
            console.log('[Background] Attempting streaming speech for explanation...');
            
            // Open audio player window for hotkey usage
            await openAudioPlayerWindow('streaming');
            
            await handleStreamingSpeech(explanationResult.explanation, settings, tab.id);
        } catch (streamError) {
            console.log('[Background] Streaming failed, trying regular generation:', streamError.message);
            
            // Fallback to regular generation
            try {
                const result = await handleSpeechGeneration(explanationResult.explanation, settings);
                
                // Open audio player window with URL
                await openAudioPlayerWindow('url', result.audioUrl);
            } catch (fallbackError) {
                console.error('Both streaming and regular generation failed:', fallbackError);
                chrome.notifications.create({
                    type: 'basic',
                    iconUrl: 'icon48.png',
                    title: 'Explanation Error',
                    message: 'Failed to generate audio explanation.'
                });
            }
        }
        
    } catch (error) {
        console.error('Hotkey explain error:', error);
        chrome.notifications.create({
            type: 'basic',
            iconUrl: 'icon48.png',
            title: 'Explanation Error',
            message: error.message || 'Failed to generate explanation'
        });
    }
}

// Handle page summary generation using LLM
async function handleGenerateSummary(content, settings) {
    const { llmProvider, llmApiKey, llmEndpoint, llmModel, outputLanguage } = settings;
    
    const language = outputLanguage === 'dutch' ? 'Dutch' : 'English';
    const languageCode = outputLanguage === 'dutch' ? 'Nederlands' : 'English';
    
    const systemPrompt = `You are a helpful accessibility assistant. Your job is to summarize webpage content in a clear, comprehensive way that sounds natural when spoken aloud. 

Guidelines:
- For SHORT pages (single topic): Create 2-3 paragraphs (4-6 sentences each)
- For LONG pages (multiple topics): 
  * Start with a comprehensive overview paragraph (4-5 sentences)
  * Then organize content into 4-7 main categories/sections
  * Provide a detailed summary (3-5 sentences) for each category
  * Include specific examples and key details when relevant
  * End with a brief concluding paragraph that ties everything together
  * Use clear transitions${language === 'Dutch' ? ' like "Ten eerste," "Vervolgens," "Daarnaast," "Tot slot"' : ' like "First," "Next," "Additionally," "Finally"'}
- Use simple, conversational language but don't oversimplify
- Include important details, statistics, or examples that enhance understanding
- Make it sound natural for text-to-speech
- Explain technical terms when they're important to the content
- Be factual, informative, and thorough
- ALWAYS output in ${language} (${languageCode}), regardless of the input language

CRITICAL SSML INSTRUCTIONS:
Apply DAISYS SSML tags to ensure perfect pronunciation. For ANY word that MIGHT be mispronounced (even 30% chance), apply the appropriate tag. When in doubt, USE PHONEME TAGS:

1. <phoneme ph="IPA notation"> - For words needing explicit pronunciation
   - Foreign/borrowed words: <phoneme ph="${language === 'Dutch' ? 'k r w ɑ s ɑ n' : 'k r w ɑː s ɒ̃'}">croissant</phoneme>
   - Names/places: <phoneme ph="${language === 'Dutch' ? 'w ʊ s t ər' : 'w ʊ s t ər'}">Worcester</phoneme>
   - Technical terms: <phoneme ph="k j u b @ k ə n t r oʊ l">kubectl</phoneme>
   - Ambiguous words: <phoneme ph="r ɛ d">read</phoneme> (past) vs <phoneme ph="r iː d">read</phoneme> (present)
   - Multiple words: use @ between words

2. <say-as interpret-as="..."> - For structured content
   - Dates: <say-as interpret-as="date">2024-03-15</say-as>
   - Times: <say-as interpret-as="time">14:30</say-as>
   - Years: <say-as interpret-as="year">1984</say-as>
   - ${language === 'Dutch' ? 'AVOID spell-out for acronyms - use phoneme tags instead' : 'Spell out acronyms: <say-as interpret-as="spell-out">CEO</say-as>'}

3. <w role="daisys:POS"> - For homographs (same spelling, different pronunciation)
   - <w role="daisys:NN">lead</w> (metal) vs <w role="daisys:VB">lead</w> (guide)
   - <w role="daisys:VBD">read</w> (past) vs <w role="daisys:VB">read</w> (present)

4. <emphasis level="moderate|strong"> - For important words
   - Key terms that need stress for clarity

BE AGGRESSIVE - Tag ANY word with potential ambiguity:
- ALL borrowed/foreign words
- ALL medical/scientific/technical terms
- ALL place names, surnames, brand names
- ALL homographs (read/read, lead/lead, live/live)
- ALL numbers, dates, times, currencies
- ALL abbreviations and acronyms
- ANY word with non-standard pronunciation
- ANY word you're unsure about
- ${language === 'Dutch' ? 'ALL English words in Dutch text (especially compounds)' : 'ALL non-English words'}

REMEMBER: It's better to over-tag than risk mispronunciation. If you think "maybe this could be mispronounced", then TAG IT!

${language === 'Dutch' ? `CRITICAL for Dutch output - DUTCH FIRST PRINCIPLE:

GOLDEN RULE: In Dutch text, EVERY word uses Dutch pronunciation unless PROVEN otherwise!
Dutch has naturalized THOUSANDS of international words with Dutch pronunciation.

NEVER assume a word is English just because it exists in English!
International words like romance, service, balance, computer ARE DUTCH in Dutch text.

Dutch pronunciation patterns for loan words:
- Words ending -ce/-se: Dutch /s/ (romance→romanse, service→survis)  
- Words ending -tion: Dutch /sie/ (station→stasie)
- ALL single words in Dutch sentences = Dutch pronunciation

Use English tags ONLY for these SPECIFIC cases:
1. Hyphenated English compounds: "live-blog", "check-in", "e-mail"
2. English phrases in quotes: "Hij zei 'never mind'"
3. Unmodified brand names: iPhone, WhatsApp, Microsoft
4. Multi-word English phrases: "machine learning", "deep learning"

NEVER tag single unhyphenated words in Dutch sentences!

DUTCH ACRONYMS - Use phoneme tags:
- SNS: <phoneme ph="ɛ s @ ɛ n @ ɛ s">SNS</phoneme>
- ASN: <phoneme ph="aː @ ɛ s @ ɛ n">ASN</phoneme>

Dutch alphabet: A=aː, B=beː, C=seː, D=deː, E=eː, F=ɛ f, G=x eː, H=h aː, I=iː, J=j eː, K=k aː, L=ɛ l, M=ɛ m, N=ɛ n, O=oː, P=peː, R=ɛ r, S=ɛ s, T=teː, U=y, V=v eː, W=w eː, X=ɪ k s, Y=ɛ i, Z=z ɛ t

CORRECT examples:
✓ "Een romance tussen twee mensen" (NO tags - romance is Dutch!)
✓ "De service is uitstekend" (NO tags - service is Dutch!)
✓ "Check de <voice language="en"><phoneme ph="tʃ ɛ k @ l ɪ s t">check-list</phoneme></voice>" (hyphenated = English)

INCORRECT:
✗ "Een <voice language="en">romance</voice>" (WRONG - single word = Dutch!)
✗ "De <voice language="en">service</voice>" (WRONG - naturalized word!)

When in doubt: DEFAULT TO DUTCH PRONUNCIATION!` : 
`Use English IPA conventions. Apply <voice language="nl"> tags for Dutch phrases within English text.
Examples:
* "The <voice language="nl"><phoneme ph="x ə z ɛ l ɪ x">gezellig</phoneme></voice> atmosphere"
* "We serve <voice language="nl"><phoneme ph="s t r oʊ p w aː f əl s">stroopwafels</phoneme></voice>"`}

TAG AGGRESSIVELY - When in doubt, add phoneme tags! Better safe than sorry.`;

    const userPrompt = `Please summarize this webpage content. If the page covers multiple distinct topics, organize them into categories. Always respond in ${language} (${languageCode}):\n\n${content}`;

    try {
        let response;
        
        if (llmProvider === 'openai') {
            response = await callOpenAI(llmApiKey, llmModel, systemPrompt, userPrompt);
        } else if (llmProvider === 'anthropic') {
            response = await callAnthropic(llmApiKey, llmModel, systemPrompt, userPrompt);
        } else if (llmProvider === 'xai') {
            response = await callXAI(llmApiKey, llmModel, systemPrompt, userPrompt);
        } else if (llmProvider === 'custom' && llmEndpoint) {
            response = await callCustomLLM(llmEndpoint, llmApiKey, llmModel, systemPrompt, userPrompt);
        } else {
            throw new Error('Invalid LLM provider configuration');
        }
        
        return { summary: response };
    } catch (error) {
        console.error('Summary generation error:', error);
        throw new Error(`Failed to generate summary: ${error.message}`);
    }
}

// Handle text explanation using LLM
async function handleExplainText(text, settings) {
    const { llmProvider, llmApiKey, llmEndpoint, llmModel, outputLanguage } = settings;
    
    const language = outputLanguage === 'dutch' ? 'Dutch' : 'English';
    const languageCode = outputLanguage === 'dutch' ? 'Nederlands' : 'English';
    
    const systemPrompt = `You are a helpful accessibility assistant. Your job is to explain difficult or complex text in simpler terms.

Guidelines:
- Use everyday language
- Break down complex concepts
- Provide context when helpful
- Keep explanations concise but clear
- Make it sound natural for text-to-speech
- Be patient and helpful
- ALWAYS output in ${language} (${languageCode}), regardless of the input language

CRITICAL SSML INSTRUCTIONS:
Apply DAISYS SSML tags for perfect pronunciation. For ANY word that MIGHT be mispronounced (even if you're slightly unsure):

1. <phoneme ph="IPA"> for explicit pronunciation (spaces between phonemes, @ between words)
2. <say-as interpret-as="date|time|year${language === 'Dutch' ? '' : '|spell-out'}"> for structured content  
3. <w role="daisys:POS"> for homographs needing context
4. <voice language="xx"> for language switches
5. <emphasis level="moderate|strong"> for important terms

${language === 'Dutch' ? `CRITICAL - DUTCH FIRST PRINCIPLE:
- ALL words in Dutch text use Dutch pronunciation by default
- International words (romance, service) are DUTCH in Dutch text
- ONLY tag: hyphenated compounds ("live-blog"), quoted English, brand names
- Dutch acronyms: <phoneme ph="ɛ s @ ɛ n @ ɛ s">SNS</phoneme>
- When unsure: DEFAULT TO DUTCH!` : 
`BE AGGRESSIVE with tags for: ALL foreign words, technical terms, names, dates/times, abbreviations, homographs.
If you're even 20% unsure, ADD PHONEME TAGS. Tag Dutch phrases with <voice language="nl">.`}`;

    const userPrompt = `Please explain this text in simpler terms, as if speaking to someone who needs clarification. Always respond in ${language} (${languageCode}):\n\n"${text}"`;

    try {
        let response;
        
        if (llmProvider === 'openai') {
            response = await callOpenAI(llmApiKey, llmModel, systemPrompt, userPrompt);
        } else if (llmProvider === 'anthropic') {
            response = await callAnthropic(llmApiKey, llmModel, systemPrompt, userPrompt);
        } else if (llmProvider === 'xai') {
            response = await callXAI(llmApiKey, llmModel, systemPrompt, userPrompt);
        } else if (llmProvider === 'custom' && llmEndpoint) {
            response = await callCustomLLM(llmEndpoint, llmApiKey, llmModel, systemPrompt, userPrompt);
        } else {
            throw new Error('Invalid LLM provider configuration');
        }
        
        return { explanation: response };
    } catch (error) {
        console.error('Explanation generation error:', error);
        throw new Error(`Failed to generate explanation: ${error.message}`);
    }
}

// OpenAI API call
async function callOpenAI(apiKey, model, systemPrompt, userPrompt) {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
            model: model || 'gpt-3.5-turbo',
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt }
            ],
            max_tokens: 1500,
            temperature: 0.7
        })
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`OpenAI API error: ${error}`);
    }

    const data = await response.json();
    return data.choices[0].message.content;
}

// Anthropic Claude API call
async function callAnthropic(apiKey, model, systemPrompt, userPrompt) {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
            model: model || 'claude-3-sonnet-20240229',
            max_tokens: 1500,
            temperature: 0.7,
            messages: [
                { role: 'user', content: `${systemPrompt}\n\n${userPrompt}` }
            ]
        })
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Anthropic API error: ${error}`);
    }

    const data = await response.json();
    return data.content[0].text;
}

// xAI Grok API call
async function callXAI(apiKey, model, systemPrompt, userPrompt) {
    const response = await fetch('https://api.x.ai/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
            model: model || 'grok-2-1212',
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt }
            ],
            max_tokens: 1500,
            temperature: 0.7
        })
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`xAI Grok API error: ${error}`);
    }

    const data = await response.json();
    return data.choices[0].message.content;
}

// Custom LLM API call
async function callCustomLLM(endpoint, apiKey, model, systemPrompt, userPrompt) {
    const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
            model: model,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt }
            ],
            max_tokens: 1500,
            temperature: 0.7
        })
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Custom LLM API error: ${error}`);
    }

    const data = await response.json();
    return data.choices[0].message.content;
}

// Process audio chunks in the background
// Note: Service workers cannot use AudioContext, so we just pass data to popup
function processAudioChunkInBackground(audioData, metadata) {
    if (!isStreamingActive) return;
    
    // Service workers can't process audio directly
    // This function is not used anymore - audio is processed in popup
    console.log('[Background] Audio chunk received, should be processed in popup');
}

function concatUint8Arrays(a, b) {
    const result = new Uint8Array(a.length + b.length);
    result.set(a, 0);
    result.set(b, a.length);
    return result;
}

// This function is no longer used - audio processing happens in popup
// Service workers cannot use AudioContext API
async function tryDecodeAndPlayChunk() {
    // Deprecated - kept for reference only
    console.warn('[Background] tryDecodeAndPlayChunk called but service workers cannot process audio');
}

// Handle streaming speech generation using MCP adapter
async function handleStreamingSpeech(text, settings, tabId) {
    const { selectedVoiceId, outputLanguage, enableSSML } = settings;
    
    // Reset streaming state
    isStreamingActive = true;
    
    try {
        // Get MCP adapter
        const adapter = await getMCPAdapter(settings);
        
        console.log('[Background] Attempting streaming TTS with voice:', selectedVoiceId);
        
        // Use MCP adapter to get streaming response
        const streamResponse = await adapter.textToSpeech({
            text: text,
            voice_id: selectedVoiceId,
            streaming: true,
            language: outputLanguage || 'english',
            enableSSML: enableSSML !== false  // Default to true
        });
        
        if (streamResponse.type !== 'streaming') {
            console.log('[Background] Adapter returned non-streaming response, switching to URL mode');
            throw new Error('Expected streaming response but got URL response');
        }
        
        const { wsUrl, requestData } = streamResponse;
        console.log('[Background] Got WebSocket URL, connecting...');

        // Create WebSocket connection
        const wsConnector = new WebsocketConnector(
            async () => wsUrl,
            (status) => {
                console.log('WebSocket status:', status);
                // Send status to audio player window
                if (audioPlayerWindow) {
                    chrome.tabs.query({ windowId: audioPlayerWindow }, (tabs) => {
                        if (tabs.length > 0) {
                            chrome.tabs.sendMessage(tabs[0].id, {
                                action: 'streamingStatus',
                                status: status,
                                tabId: tabId
                            }).catch(() => {});
                        }
                    });
                }
                
                // Also try sending to popup
                chrome.runtime.sendMessage({
                    action: 'streamingStatus',
                    status: status,
                    tabId: tabId
                }).catch(() => {
                    // Popup might not be open, ignore error
                });
            }
        );

        // Create stream handler
        const wsStream = new WebsocketStream(wsConnector);
        
        // Store connection for cleanup
        wsConnections.set(tabId, { connector: wsConnector, stream: wsStream });

        // Connect to WebSocket
        await wsConnector.connect();

        // Get request ID from MCP adapter response
        const requestId = requestData.request_id;

        // Send generation command from MCP adapter response
        wsStream.send(requestData);

        // Process message stream
        const messageStream = wsStream.messageStream(requestId);
        
        for await (const message of messageStream) {
            if (message.type === 'status') {
                console.log('Status update:', JSON.stringify(message.data));
                
                // Send status to audio player window
                if (audioPlayerWindow) {
                    chrome.tabs.query({ windowId: audioPlayerWindow }, (tabs) => {
                        if (tabs.length > 0) {
                            chrome.tabs.sendMessage(tabs[0].id, {
                                action: 'streamingMessage',
                                type: 'status',
                                data: message.data,
                                tabId: tabId
                            }).catch(() => {});
                        }
                    });
                }
                
                // Also try sending to popup
                chrome.runtime.sendMessage({
                    action: 'streamingMessage',
                    type: 'status',
                    data: message.data,
                    tabId: tabId
                }).catch(() => {
                    // Popup might not be open, ignore error
                });
                
                if (message.data.status === 'error') {
                    throw new Error(message.data.message || 'Streaming error');
                }
            } else if (message.type === 'audio') {
                console.log('[Background] Audio chunk received:', {
                    partId: message.data.metadata.part_id,
                    size: message.data.audioData.byteLength,
                    metadata: message.data.metadata
                });
                
                // Convert ArrayBuffer to array for message passing
                const audioArray = Array.from(new Uint8Array(message.data.audioData));
                
                // Send audio chunk to audio player window
                if (audioPlayerWindow) {
                    chrome.tabs.query({ windowId: audioPlayerWindow }, (tabs) => {
                        if (tabs.length > 0) {
                            chrome.tabs.sendMessage(tabs[0].id, {
                                action: 'streamingMessage',
                                type: 'audioChunk',
                                audioData: audioArray,
                                metadata: message.data.metadata,
                                tabId: tabId
                            }).catch(() => {});
                        }
                    });
                }
                
                // Also try sending to popup
                chrome.runtime.sendMessage({
                    action: 'streamingMessage',
                    type: 'audioChunk',
                    audioData: audioArray,
                    metadata: message.data.metadata,
                    tabId: tabId
                }).catch(() => {
                    // Popup might not be open, ignore error
                });
            } else {
                console.log('[Background] Unknown message type:', message.type, message);
            }
        }

        // Streaming complete
        if (audioPlayerWindow) {
            chrome.tabs.query({ windowId: audioPlayerWindow }, (tabs) => {
                if (tabs.length > 0) {
                    chrome.tabs.sendMessage(tabs[0].id, {
                        action: 'streamingComplete',
                        tabId: tabId
                    }).catch(() => {});
                }
            });
        }
        
        chrome.runtime.sendMessage({
            action: 'streamingComplete',
            tabId: tabId
        }).catch(() => {
            // Popup might not be open, ignore error
        });

        return { success: true };
    } catch (error) {
        console.error('[Background] Streaming speech error:', error);
        
        // Clean up connection
        const connection = wsConnections.get(tabId);
        if (connection) {
            connection.connector.close();
            wsConnections.delete(tabId);
        }
        
        // Check if it's a WebSocket availability issue
        if (error.message.includes('WebSocket') || error.message.includes('streaming')) {
            console.log('[Background] WebSocket streaming not available, will use fallback');
            throw new Error('WebSocket streaming unavailable - use fallback mode');
        }
        
        throw new Error(`Failed to stream speech: ${error.message}`);
    }
}

// Handle voice generation using MCP adapter
async function handleVoiceGenerationWithMCP(voiceData, settings) {
    const { name, gender, model } = voiceData;
    
    try {
        // Get MCP adapter
        const adapter = await getMCPAdapter(settings);
        
        // Use MCP adapter to create voice
        const voiceInfo = await adapter.createVoice({
            name: name,
            gender: gender,
            model: model,
            expression: 5 // Normal expression for accessibility
        });
        
        return {
            success: true,
            voice: {
                id: voiceInfo.voice_id,
                name: voiceInfo.name,
                gender: voiceInfo.gender,
                model: voiceInfo.model
            }
        };
    } catch (error) {
        console.error('Voice generation error:', error);
        throw new Error(`Failed to generate voice: ${error.message}`);
    }
}

// Get available DAISYS models using MCP adapter
async function getDaisysModelsWithMCP(settings) {
    
    try {
        // Get MCP adapter
        const adapter = await getMCPAdapter(settings);
        
        // Use MCP adapter to get models
        const models = await adapter.getModels({});
        
        return {
            success: true,
            models: models
        };
    } catch (error) {
        console.error('Get models error:', error);
        throw new Error(`Failed to get models: ${error.message}`);
    }
}

// Handle regular speech generation (non-streaming) using MCP adapter
async function handleSpeechGeneration(text, settings) {
    const { selectedVoiceId, outputLanguage, enableSSML } = settings;
    
    try {
        // Get MCP adapter
        const adapter = await getMCPAdapter(settings);
        
        // Use MCP adapter for non-streaming TTS
        const result = await adapter.textToSpeech({
            text: text,
            voice_id: selectedVoiceId,
            audio_format: 'wav',
            streaming: false,
            language: outputLanguage || 'english',
            enableSSML: enableSSML !== false  // Default to true
        });
        
        if (result.type !== 'url') {
            throw new Error('Expected URL response for non-streaming TTS');
        }
        
        const audioUrl = result.audioUrl;
        
        return { audioUrl };
    } catch (error) {
        console.error('Speech generation error:', error);
        throw new Error(`Failed to generate speech: ${error.message}`);
    }
}

// Test DAISYS API connection and fetch voices using MCP adapter
async function testDaisysAPIWithMCP(settings) {
    console.log('[Background] Testing DAISYS API with settings:', settings);
    
    if (!settings) {
        throw new Error('No settings provided to testDaisysAPIWithMCP');
    }
    
    if (!settings.daisysEmail || !settings.daisysPassword) {
        throw new Error('DAISYS email or password not provided');
    }
    
    try {
        // Get MCP adapter
        const adapter = await getMCPAdapter(settings);
        
        // Use MCP adapter to get voices
        const voices = await adapter.getVoices({});
        
        return { 
            success: true, 
            voices: voices.map(v => ({
                id: v.voice_id,
                name: v.name,
                gender: v.gender,
                model: v.model
            }))
        };
    } catch (error) {
        console.error('DAISYS API test error:', error);
        throw new Error(`DAISYS API test failed: ${error.message}`);
    }
}