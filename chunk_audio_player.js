// Chunk-based audio player for DAISYS WebSocket streaming
// Based on official DAISYS websocket example

import { parseWavHeader, decodePCM } from './audio_utils.js';

export class ChunkAudioPlayer {
    constructor(audioContext) {
        this.audioContext = audioContext;
        this.sampleBuffer = [];
        this.isStreaming = false;
        this.scriptNode = null;
        this.wavHeader = null;
        this.isFirstChunk = true;
    }

    async playAudio(audioData) {
        let dataToProcess = audioData;
        
        // Parse WAV header from first chunk
        if (this.isFirstChunk && audioData.byteLength > 44) {
            this.wavHeader = parseWavHeader(audioData);
            dataToProcess = audioData.slice(44); // Skip WAV header
            this.isFirstChunk = false;
        }
        
        // Decode PCM samples
        const samples = decodePCM(dataToProcess);
        
        // Add to buffer
        for (let i = 0; i < samples.length; i++) {
            this.sampleBuffer.push(samples[i]);
        }
        
        // Start streaming if not already started
        if (!this.isStreaming && this.sampleBuffer.length > 4096) {
            this.startStreaming();
        }
    }

    startStreaming() {
        if (this.isStreaming) return;
        
        this.isStreaming = true;
        
        // Create ScriptProcessorNode (deprecated but still widely supported)
        // For production, consider using AudioWorklet
        const bufferSize = 4096;
        this.scriptNode = this.audioContext.createScriptProcessor(bufferSize, 1, 1);
        
        this.scriptNode.onaudioprocess = (event) => {
            const output = event.outputBuffer.getChannelData(0);
            
            for (let i = 0; i < output.length; i++) {
                if (this.sampleBuffer.length > 0) {
                    output[i] = this.sampleBuffer.shift();
                } else {
                    output[i] = 0;
                }
            }
        };
        
        this.scriptNode.connect(this.audioContext.destination);
    }

    endStream() {
        // Let remaining audio play out
        setTimeout(() => {
            if (this.scriptNode) {
                this.scriptNode.disconnect();
                this.scriptNode = null;
            }
            this.isStreaming = false;
            this.sampleBuffer = [];
            this.isFirstChunk = true;
        }, (this.sampleBuffer.length / this.audioContext.sampleRate) * 1000 + 100);
    }

    stop() {
        if (this.scriptNode) {
            this.scriptNode.disconnect();
            this.scriptNode = null;
        }
        this.isStreaming = false;
        this.sampleBuffer = [];
        this.isFirstChunk = true;
    }
}