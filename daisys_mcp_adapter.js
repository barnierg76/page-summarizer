// DAISYS MCP-style Adapter for WebCommenter Extension
// This adapter provides MCP-like interface while using DAISYS WebSocket API directly

class DaisysMCPAdapter {
    constructor() {
        this.wsConnector = null;
        this.wsStream = null;
        this.authToken = null;
        this.voices = [];
        this.models = [];
        this.ssmlProcessor = null;
        
        // Try to load SSML processor if available
        try {
            if (typeof SSMLProcessor !== 'undefined') {
                this.ssmlProcessor = new SSMLProcessor();
            }
        } catch (e) {
            console.log('[MCP Adapter] SSML processor not available');
        }
    }

    async initialize(email, password) {
        try {
            // Authenticate with DAISYS
            const authResponse = await fetch('https://api.daisys.ai/auth/login', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ email, password })
            });

            if (!authResponse.ok) {
                throw new Error('Failed to authenticate with DAISYS');
            }

            const authData = await authResponse.json();
            this.authToken = authData.access_token;
            
            return { success: true };
        } catch (error) {
            console.error('DAISYS MCP Adapter initialization error:', error);
            throw error;
        }
    }

    async textToSpeech(params) {
        const {
            text,
            voice_id = null,
            audio_format = 'wav',
            streaming = true,
            language = 'english',
            enableSSML = true
        } = params;

        if (!this.authToken) {
            throw new Error('Not authenticated. Call initialize() first.');
        }

        // Process text with SSML if processor is available and enabled
        let processedText = text;
        if (this.ssmlProcessor && enableSSML) {
            console.log('[MCP Adapter] Processing text with SSML for', language);
            processedText = this.ssmlProcessor.processText(text, language, enableSSML);
            // Clean up any issues
            processedText = this.ssmlProcessor.cleanupSSML(processedText);
            console.log('[MCP Adapter] SSML processing complete');
        }

        // Get voice ID if not provided
        let voiceId = voice_id;
        if (!voiceId) {
            const voices = await this.getVoices({});
            if (voices.length > 0) {
                voiceId = voices[voices.length - 1].voice_id;
            } else {
                throw new Error('No voices available');
            }
        }

        // Check if streaming should be disabled (for testing)
        let forceNonStreaming = false;
        
        // Check if we're in a browser environment with localStorage
        if (typeof localStorage !== 'undefined') {
            forceNonStreaming = localStorage.getItem('daisys_force_non_streaming') === 'true';
        }
        
        if (streaming && !forceNonStreaming) {
            console.log('[MCP Adapter] Attempting streaming mode for voice:', voiceId);
            const startTime = Date.now();
            const result = await this.streamTextToSpeech(processedText, voiceId);
            console.log('[MCP Adapter] Streaming setup completed in', Date.now() - startTime, 'ms');
            return result;
        } else {
            console.log('[MCP Adapter] Using non-streaming mode', forceNonStreaming ? '(forced)' : '');
            return await this.generateTextToSpeech(processedText, voiceId, audio_format);
        }
    }

    async streamTextToSpeech(text, voiceId) {
        try {
            // Get WebSocket URL using the correct endpoint
            console.log('[MCP Adapter] Requesting WebSocket URL');
            const wsUrlResponse = await fetch('https://api.daisys.ai/v1/speak/websocket/url', {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${this.authToken}`
                }
            });

            if (!wsUrlResponse.ok) {
                let errorText = '';
                try {
                    errorText = await wsUrlResponse.text();
                } catch (e) {
                    errorText = 'Unable to read error response';
                }
                
                console.error('[MCP Adapter] WebSocket URL request failed:', {
                    status: wsUrlResponse.status,
                    statusText: wsUrlResponse.statusText,
                    body: errorText,
                    endpoint: 'https://api.daisys.ai/v1/speak/websocket/url'
                });
                
                throw new Error(`Failed to get WebSocket URL: ${wsUrlResponse.status} - ${errorText}`);
            }

            const wsData = await wsUrlResponse.json();
            console.log('[MCP Adapter] WebSocket URL response:', wsData);
            
            if (!wsData.worker_websocket_url) {
                console.error('[MCP Adapter] No worker_websocket_url in response:', wsData);
                throw new Error('WebSocket URL not found in response');
            }
            
            const { worker_websocket_url } = wsData;

            // Create streaming response object with correct command
            const streamResponse = {
                type: 'streaming',
                voiceId: voiceId,
                wsUrl: worker_websocket_url,
                requestData: {
                    command: '/takes/generate', // Note: plural 'takes'
                    request_id: 1,
                    data: {
                        text: text,
                        voice_id: voiceId,
                        prosody: {
                            pace: 0,
                            pitch: 0,
                            expression: 5
                        },
                        stream_options: {
                            mode: 'chunks' // Use chunks mode for real-time streaming
                        }
                    }
                }
            };

            return streamResponse;
        } catch (error) {
            console.error('[MCP Adapter] Stream TTS error:', error);
            // Add more context to the error
            if (error.message.includes('WebSocket URL')) {
                throw new Error(`Streaming not available: ${error.message}. Will fallback to non-streaming mode.`);
            }
            throw error;
        }
    }

    async generateTextToSpeech(text, voiceId, audioFormat) {
        try {
            // Generate take
            const takeResponse = await fetch('https://api.daisys.ai/v1/speak/takes/generate', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.authToken}`
                },
                body: JSON.stringify({
                    voice_id: voiceId,
                    text: text,
                    prosody: {
                        pace: 0,
                        pitch: 0,
                        expression: 8
                    }
                })
            });

            if (!takeResponse.ok) {
                throw new Error('Failed to generate speech');
            }

            const takeData = await takeResponse.json();
            const takeId = takeData.take_id;

            // Wait for take to be ready
            let status = takeData.status;
            let attempts = 0;
            const maxAttempts = 30;

            while (status !== 'ready' && attempts < maxAttempts) {
                await new Promise(resolve => setTimeout(resolve, 1000));
                
                const statusResponse = await fetch(`https://api.daisys.ai/v1/speak/takes/${takeId}`, {
                    headers: {
                        'Authorization': `Bearer ${this.authToken}`
                    }
                });

                if (statusResponse.ok) {
                    const statusData = await statusResponse.json();
                    status = statusData.status;
                }
                
                attempts++;
            }

            if (status !== 'ready') {
                throw new Error('Speech generation timed out');
            }

            // Get audio URL
            const audioEndpoint = audioFormat === 'mp3' ? 'mp3' : 'wav';
            const audioResponse = await fetch(`https://api.daisys.ai/v1/speak/takes/${takeId}/${audioEndpoint}`, {
                headers: {
                    'Authorization': `Bearer ${this.authToken}`
                }
            });

            if (!audioResponse.ok) {
                throw new Error('Failed to get audio URL');
            }

            const audioUrl = audioResponse.url || audioResponse.headers.get('Location');

            return {
                type: 'url',
                audioUrl: audioUrl,
                voiceId: voiceId
            };
        } catch (error) {
            console.error('Generate TTS error:', error);
            throw error;
        }
    }

    async getVoices(params = {}) {
        const { model, gender, sort_by = 'name', sort_direction = 'asc' } = params;

        try {
            const response = await fetch('https://api.daisys.ai/v1/speak/voices', {
                headers: {
                    'Authorization': `Bearer ${this.authToken}`
                }
            });

            if (!response.ok) {
                throw new Error('Failed to fetch voices');
            }

            let voices = await response.json();

            // Filter voices
            if (model || gender) {
                voices = voices.filter(voice => 
                    (!model || voice.model === model) &&
                    (!gender || voice.gender === gender)
                );
            }

            // Sort voices
            voices.sort((a, b) => {
                const aVal = a[sort_by] || '';
                const bVal = b[sort_by] || '';
                const comparison = aVal.toLowerCase().localeCompare(bVal.toLowerCase());
                return sort_direction === 'asc' ? comparison : -comparison;
            });

            // Transform to MCP format
            return voices.map(v => ({
                voice_id: v.voice_id,
                name: v.name,
                gender: v.gender,
                model: v.model,
                description: v.description || null
            }));
        } catch (error) {
            console.error('Get voices error:', error);
            throw error;
        }
    }

    async getModels(params = {}) {
        const { language, sort_by = 'displayname', sort_direction = 'asc' } = params;

        try {
            const response = await fetch('https://api.daisys.ai/v1/speak/models', {
                headers: {
                    'Authorization': `Bearer ${this.authToken}`
                }
            });

            if (!response.ok) {
                throw new Error('Failed to fetch models');
            }

            let models = await response.json();

            // Filter by language
            if (language) {
                const langPrefix = language.toLowerCase().substring(0, 2);
                models = models.filter(model =>
                    model.languages.some(lang => lang.toLowerCase().startsWith(langPrefix))
                );
            }

            // Sort models
            models.sort((a, b) => {
                const aVal = a[sort_by] || a.name || '';
                const bVal = b[sort_by] || b.name || '';
                const comparison = aVal.toLowerCase().localeCompare(bVal.toLowerCase());
                return sort_direction === 'asc' ? comparison : -comparison;
            });

            return models.map(m => ({
                name: m.name,
                displayName: m.displayname || m.name,
                genders: m.genders || []
            }));
        } catch (error) {
            console.error('Get models error:', error);
            throw error;
        }
    }

    async createVoice(params) {
        const {
            name = 'Daisy',
            gender = 'female',
            model = 'english-v3.0',
            pitch = 0,
            pace = 0,
            expression = 0
        } = params;

        try {
            const response = await fetch('https://api.daisys.ai/v1/speak/voices/generate', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.authToken}`
                },
                body: JSON.stringify({
                    name: name,
                    gender: gender,
                    model: model,
                    example_take: {
                        text: "Hey there! I'm your new comedy sidekick. Ready to roast some websites and drop some sick burns? Let's make the internet laugh, one page at a time!",
                        prosody: {
                            pace: pace,
                            pitch: pitch,
                            expression: expression
                        }
                    }
                })
            });

            if (!response.ok) {
                throw new Error('Failed to generate voice');
            }

            const voiceInfo = await response.json();
            
            // Wait for voice to be ready
            let attempts = 0;
            const maxAttempts = 60;
            
            while (voiceInfo.status !== 'ready' && attempts < maxAttempts) {
                await new Promise(resolve => setTimeout(resolve, 1000));
                
                const statusResponse = await fetch(`https://api.daisys.ai/v1/speak/voices/${voiceInfo.voice_id}`, {
                    headers: {
                        'Authorization': `Bearer ${this.authToken}`
                    }
                });
                
                if (statusResponse.ok) {
                    const statusData = await statusResponse.json();
                    voiceInfo.status = statusData.status;
                    
                    if (statusData.status === 'error') {
                        throw new Error('Voice generation failed');
                    }
                }
                
                attempts++;
            }
            
            if (voiceInfo.status !== 'ready') {
                throw new Error('Voice generation timed out');
            }

            return {
                voice_id: voiceInfo.voice_id,
                name: voiceInfo.name,
                gender: voiceInfo.gender,
                model: voiceInfo.model,
                description: voiceInfo.description || null
            };
        } catch (error) {
            console.error('Create voice error:', error);
            throw error;
        }
    }

    async removeVoice(voiceId) {
        try {
            const response = await fetch(`https://api.daisys.ai/v1/speak/voices/${voiceId}`, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${this.authToken}`
                }
            });

            if (!response.ok) {
                throw new Error('Failed to delete voice');
            }

            return { success: true, message: `Voice ${voiceId} deleted successfully` };
        } catch (error) {
            console.error('Remove voice error:', error);
            throw error;
        }
    }
}

// Export for use in extension
if (typeof module !== 'undefined' && module.exports) {
    module.exports = DaisysMCPAdapter;
}