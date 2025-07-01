// WebSocket connector for DAISYS API
// Based on official DAISYS websocket example

export class WebsocketConnector {
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