// Audio utility functions for DAISYS WebSocket streaming
// Based on official DAISYS websocket example

export function parseWavHeader(arrayBuffer) {
    const view = new DataView(arrayBuffer);
    
    // Basic WAV header parsing
    const numChannels = view.getUint16(22, true);
    const sampleRate = view.getUint32(24, true);
    const bitsPerSample = view.getUint16(34, true);
    
    return {
        numChannels,
        sampleRate,
        bitsPerSample
    };
}

export function decodePCM(arrayBuffer, offset = 0) {
    // Convert 16-bit PCM to Float32Array
    const int16Array = new Int16Array(arrayBuffer, offset);
    const float32Array = new Float32Array(int16Array.length);
    
    for (let i = 0; i < int16Array.length; i++) {
        // Normalize to range [-1, 1]
        float32Array[i] = int16Array[i] / 32768.0;
    }
    
    return float32Array;
}

export function splitInfoPrefix(arrayBuffer) {
    try {
        // Check for JSON chunk at start
        const view = new DataView(arrayBuffer);
        const decoder = new TextDecoder();
        
        // Look for null byte delimiter
        let jsonEndIndex = -1;
        for (let i = 0; i < Math.min(1024, arrayBuffer.byteLength); i++) {
            if (view.getUint8(i) === 0) {
                jsonEndIndex = i;
                break;
            }
        }
        
        if (jsonEndIndex > 0) {
            const jsonBytes = new Uint8Array(arrayBuffer, 0, jsonEndIndex);
            const jsonString = decoder.decode(jsonBytes);
            const json = JSON.parse(jsonString);
            const audioData = arrayBuffer.slice(jsonEndIndex + 1);
            return { json, audioData };
        }
    } catch (error) {
        // No valid JSON prefix
    }
    
    return { json: null, audioData: arrayBuffer };
}