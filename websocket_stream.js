// WebSocket stream handler for DAISYS API
// Based on the DAISYS WebSocket protocol documentation

export class WebsocketStream {
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