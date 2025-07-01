// Bundled WebSocket classes for service worker
// This avoids ES6 module issues in service workers

class WebsocketConnector {
    constructor(fetchWebSocketUrl, connectionStatusCallback) {
        this.fetchWebSocketUrl = fetchWebSocketUrl;
        this.connectionStatusCallback = connectionStatusCallback || (() => {});
        this.websocket = null;
        this.messageCallbacks = [];
        this.binaryCallbacks = [];
        this.isConnecting = false;
        this.shouldReconnect = true;
        
        // Exponential backoff configuration
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 10;
        this.baseReconnectDelay = 1000; // 1 second
        this.maxReconnectDelay = 30000; // 30 seconds
        this.reconnectBackoffMultiplier = 1.5;
    }

    async connect() {
        if (this.isConnecting || (this.websocket && this.websocket.readyState === WebSocket.OPEN)) {
            return;
        }

        this.isConnecting = true;
        
        return new Promise(async (resolve, reject) => {
            try {
                // Fetch the WebSocket URL dynamically
                const wsUrl = await this.fetchWebSocketUrl();
                
                if (!wsUrl) {
                    throw new Error('Failed to get WebSocket URL');
                }

                this.websocket = new WebSocket(wsUrl);
                this.websocket.binaryType = 'arraybuffer';

                this.websocket.onopen = () => {
                    console.log('WebSocket connected');
                    this.isConnecting = false;
                    this.reconnectAttempts = 0; // Reset reconnect attempts on successful connection
                    this.connectionStatusCallback('connected');
                    resolve(); // Resolve the promise when connection is open
                };

                this.websocket.onmessage = (event) => {
                    if (typeof event.data === 'string') {
                        // Text message (JSON)
                        this.messageCallbacks.forEach(callback => callback(event.data));
                    } else {
                        // Binary message (audio data)
                        this.binaryCallbacks.forEach(callback => callback(event.data));
                    }
                };

                this.websocket.onerror = (error) => {
                    console.error('WebSocket error:', error);
                    this.connectionStatusCallback('error');
                    reject(new Error('WebSocket connection error'));
                };

                this.websocket.onclose = () => {
                    console.log('WebSocket disconnected');
                    this.isConnecting = false;
                    this.connectionStatusCallback('disconnected');
                    
                    // Auto-reconnect with exponential backoff
                    if (this.shouldReconnect && this.reconnectAttempts < this.maxReconnectAttempts) {
                        const delay = this.calculateReconnectDelay();
                        console.log(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts + 1}/${this.maxReconnectAttempts})`);
                        setTimeout(() => this.connect(), delay);
                    } else if (this.reconnectAttempts >= this.maxReconnectAttempts) {
                        console.error('Max reconnection attempts reached');
                        this.connectionStatusCallback('failed');
                    }
                };
            } catch (error) {
                console.error('Failed to connect WebSocket:', error);
                this.isConnecting = false;
                this.connectionStatusCallback('error');
                
                // Retry connection with exponential backoff
                if (this.shouldReconnect && this.reconnectAttempts < this.maxReconnectAttempts) {
                    const delay = this.calculateReconnectDelay();
                    console.log(`Reconnecting after error in ${delay}ms (attempt ${this.reconnectAttempts + 1}/${this.maxReconnectAttempts})`);
                    setTimeout(() => this.connect(), delay);
                } else if (this.reconnectAttempts >= this.maxReconnectAttempts) {
                    console.error('Max reconnection attempts reached after error');
                    this.connectionStatusCallback('failed');
                }
                
                reject(error);
            }
        });
    }

    send(data) {
        if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
            this.websocket.send(data);
        } else {
            console.error('WebSocket is not connected');
        }
    }

    onMessage(callback) {
        this.messageCallbacks.push(callback);
    }

    onBinary(callback) {
        this.binaryCallbacks.push(callback);
    }

    close() {
        this.shouldReconnect = false;
        this.reconnectAttempts = 0; // Reset reconnect attempts
        if (this.websocket) {
            this.websocket.close();
            this.websocket = null;
        }
    }
    
    calculateReconnectDelay() {
        this.reconnectAttempts++;
        // Calculate delay with exponential backoff
        const delay = Math.min(
            this.baseReconnectDelay * Math.pow(this.reconnectBackoffMultiplier, this.reconnectAttempts - 1),
            this.maxReconnectDelay
        );
        // Add jitter to prevent thundering herd
        const jitter = Math.random() * 0.3 * delay; // ±30% jitter
        return Math.round(delay + jitter - (delay * 0.15));
    }
    
    resetReconnection() {
        this.reconnectAttempts = 0;
        this.shouldReconnect = true;
    }
}

class WebsocketStream {
    constructor(wsConnector) {
        this.wsConnector = wsConnector;
        this.handlers = new Map();
        
        // Set up message routing
        this.wsConnector.onMessage(this.routeTextMessage.bind(this));
        this.wsConnector.onBinary(this.routeBinaryMessage.bind(this));
    }

    routeTextMessage(message) {
        try {
            const data = JSON.parse(message);
            const requestId = data.request_id;
            
            console.log('[WebsocketStream] Text message received:', data);
            
            if (requestId && this.handlers.has(requestId)) {
                const handler = this.handlers.get(requestId);
                handler.textMessages.push(data);
                handler.textResolve();
            }
        } catch (error) {
            console.error('Failed to parse text message:', error);
        }
    }

    routeBinaryMessage(arrayBuffer) {
        // DAISYS sends binary messages with metadata prefix
        // Format: JSON<length 4 bytes><json metadata>RIFF<audio data>
        
        console.log('[WebsocketStream] Binary message received, size:', arrayBuffer.byteLength);
        
        try {
            const data = new Uint8Array(arrayBuffer);
            
            // Check if this is a DAISYS formatted message
            if (data.length > 4 && String.fromCharCode(...data.slice(0, 4)) === 'JSON') {
                console.log('[WebsocketStream] Detected DAISYS format message');
                // Parse metadata length
                const view = new DataView(arrayBuffer);
                const metadataLength = view.getUint32(4, true); // little-endian
                
                // Extract metadata
                const metadataBytes = data.slice(8, 8 + metadataLength);
                const metadataString = new TextDecoder().decode(metadataBytes);
                const metadata = JSON.parse(metadataString);
                
                // Extract audio data
                const audioData = arrayBuffer.slice(8 + metadataLength);
                
                // Route to appropriate handler
                const requestId = metadata.request_id;
                if (requestId && this.handlers.has(requestId)) {
                    const handler = this.handlers.get(requestId);
                    
                    // Check if this is an empty chunk (signals completion)
                    // DAISYS sends a small final message to signal end
                    if (audioData.byteLength === 0 || audioData.byteLength < 100) {
                        console.log('[WebsocketStream] Received end signal (empty/small chunk), marking stream complete');
                        handler.binaryComplete = true;
                        handler.textComplete = true;
                        handler.binaryResolve();
                    } else {
                        handler.binaryMessages.push({
                            metadata: metadata,
                            audioData: audioData
                        });
                        handler.binaryResolve();
                        
                        // Track received parts
                        if (metadata.part_id !== undefined) {
                            handler.receivedParts.add(metadata.part_id);
                            console.log(`[WebsocketStream] Received part ${metadata.part_id}, total: ${handler.receivedParts.size}/${handler.expectedParts}`);
                            
                            // Check if we've received all expected parts
                            if (handler.expectedParts > 0 && handler.receivedParts.size >= handler.expectedParts && handler.textComplete) {
                                console.log('[WebsocketStream] All expected parts received, marking stream complete');
                                handler.binaryComplete = true;
                            }
                        }
                    }
                }
            } else {
                // Fallback: treat as raw audio for the most recent handler
                let activeHandler = null;
                for (const [requestId, handler] of this.handlers) {
                    if (!handler.binaryComplete) {
                        activeHandler = handler;
                        break;
                    }
                }
                
                if (activeHandler) {
                    activeHandler.binaryMessages.push({
                        metadata: { request_id: activeHandler.requestId },
                        audioData: arrayBuffer
                    });
                    activeHandler.binaryResolve();
                }
            }
        } catch (error) {
            console.error('Failed to process binary message:', error);
        }
    }

    async *messageStream(requestId) {
        const handler = {
            requestId: requestId,
            textMessages: [],
            binaryMessages: [],
            textResolve: () => {},
            binaryResolve: () => {},
            textComplete: false,
            binaryComplete: false,
            expectedParts: 0,
            receivedParts: new Set()
        };
        
        this.handlers.set(requestId, handler);
        
        try {
            while (!handler.textComplete || !handler.binaryComplete) {
                // Wait for new messages
                await Promise.race([
                    new Promise(resolve => { handler.textResolve = resolve; }),
                    new Promise(resolve => { handler.binaryResolve = resolve; })
                ]);
                
                // Process text messages
                while (handler.textMessages.length > 0) {
                    const message = handler.textMessages.shift();
                    yield { type: 'status', data: message };
                    
                    // Check for completion
                    if (message.status === 'completed' || message.status === 'error') {
                        handler.textComplete = true;
                        // Don't mark binary as complete yet - wait for empty chunk or all parts
                        console.log('[WebsocketStream] Text completed, waiting for remaining audio chunks');
                        if (message.data && message.data.parts_count) {
                            handler.expectedParts = message.data.parts_count;
                            console.log(`[WebsocketStream] Expecting ${handler.expectedParts} audio parts`);
                        }
                    }
                }
                
                // Process binary messages (audio chunks)
                while (handler.binaryMessages.length > 0) {
                    const message = handler.binaryMessages.shift();
                    yield { type: 'audio', data: message };
                }
            }
        } finally {
            this.handlers.delete(requestId);
        }
    }

    send(data) {
        if (typeof data === 'object') {
            this.wsConnector.send(JSON.stringify(data));
        } else {
            this.wsConnector.send(data);
        }
    }

    close() {
        this.wsConnector.close();
    }
}