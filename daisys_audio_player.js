// Audio player for DAISYS WebSocket streaming
// Handles sequential playback of WAV parts

export class DaisysAudioPlayer {
    constructor(audioContext) {
        this.audioContext = audioContext;
        this.partQueue = new Map();
        this.nextPartToPlay = null; // Will be set based on first part received
        this.isPlaying = false;
        this.activeSource = null;
        
        // Memory management settings
        this.maxQueueSize = 50; // Maximum parts to keep in queue (increased for longer texts)
        this.totalAudioDuration = 0; // Track total audio duration
        this.maxTotalDuration = 600; // Maximum 10 minutes of audio in memory
        
        // Performance tracking
        this.firstPartReceivedTime = null;
        this.firstPartPlayedTime = null;
        this.minPartId = null;
        this.maxPartId = null;
    }

    async addPart(partId, audioData) {
        try {
            // Check memory limits before adding
            if (this.partQueue.size >= this.maxQueueSize) {
                console.error(`[DaisysAudioPlayer] ❌ DROPPING PART ${partId} - Queue full (${this.partQueue.size}/${this.maxQueueSize})`);
                console.error(`[DaisysAudioPlayer] Current queue: [${Array.from(this.partQueue.keys()).sort((a,b) => a-b).join(', ')}]`);
                console.error(`[DaisysAudioPlayer] Next to play: ${this.nextPartToPlay}`);
                return;
            }
            
            if (this.totalAudioDuration >= this.maxTotalDuration) {
                console.warn(`[DaisysAudioPlayer] Total duration limit reached (${this.maxTotalDuration}s), dropping part ${partId}`);
                return;
            }
            
            // DAISYS sends complete WAV files for each part
            // Convert to AudioBuffer
            const audioBuffer = await this.audioContext.decodeAudioData(audioData.slice(0));
            
            // Update total duration tracking
            this.totalAudioDuration += audioBuffer.duration;
            
            // Store in queue
            this.partQueue.set(partId, audioBuffer);
            
            // Track min/max part IDs
            if (this.minPartId === null || partId < this.minPartId) {
                this.minPartId = partId;
            }
            if (this.maxPartId === null || partId > this.maxPartId) {
                this.maxPartId = partId;
            }
            
            // Track first part received time and set initial nextPartToPlay
            if (this.firstPartReceivedTime === null) {
                this.firstPartReceivedTime = Date.now();
                this.nextPartToPlay = partId; // Start from first received part
                console.log(`[DaisysAudioPlayer] First part received (part ${partId}) - setting as start point`);
            }
            
            console.log(`[DaisysAudioPlayer] Added part ${partId}, duration: ${audioBuffer.duration}s, queue: [${Array.from(this.partQueue.keys()).sort((a,b) => a-b).join(', ')}]`);
            
            // Clean up old parts if we're getting too far ahead
            this.cleanupOldParts();
            
            // Start playing if not already
            if (!this.isPlaying) {
                this.playNextPart();
            }
        } catch (error) {
            console.error(`[DaisysAudioPlayer] Error decoding part ${partId}:`, error);
        }
    }

    playNextPart() {
        // If nextPartToPlay is not set yet, wait
        if (this.nextPartToPlay === null) {
            this.isPlaying = false;
            return;
        }
        
        // Check if we have the next part in sequence
        let nextPart = this.partQueue.get(this.nextPartToPlay);
        
        // If not found and we have parts, try to find the next available part
        if (!nextPart && this.partQueue.size > 0) {
            const availableParts = Array.from(this.partQueue.keys()).sort((a, b) => a - b);
            for (const partId of availableParts) {
                if (partId >= this.nextPartToPlay) {
                    console.log(`[DaisysAudioPlayer] Part ${this.nextPartToPlay} missing, skipping to part ${partId}`);
                    this.nextPartToPlay = partId;
                    nextPart = this.partQueue.get(partId);
                    break;
                }
            }
        }
        
        if (!nextPart) {
            // Next part not ready yet
            this.isPlaying = false;
            console.log(`[DaisysAudioPlayer] Waiting for part ${this.nextPartToPlay} (have parts: ${Array.from(this.partQueue.keys()).sort((a,b) => a-b).join(', ')})`);
            
            // Check again soon
            setTimeout(() => {
                if (!this.isPlaying && this.partQueue.size > 0) {
                    this.playNextPart();
                }
            }, 50);
            return;
        }
        
        this.isPlaying = true;
        const currentPartId = this.nextPartToPlay;
        this.nextPartToPlay++;
        
        // Update duration tracking
        this.totalAudioDuration -= nextPart.duration;
        
        // Remove from queue to free memory
        this.partQueue.delete(currentPartId);
        
        // Create and play source
        this.activeSource = this.audioContext.createBufferSource();
        this.activeSource.buffer = nextPart;
        this.activeSource.connect(this.audioContext.destination);
        
        // When this part ends, play the next one
        this.activeSource.onended = () => {
            console.log(`[DaisysAudioPlayer] Finished playing part ${currentPartId}`);
            this.activeSource = null;
            // Explicitly nullify the buffer to help garbage collection
            nextPart = null;
            this.playNextPart();
        };
        
        // Start playback
        this.activeSource.start(0);
        
        // Track first part played time
        if (this.firstPartPlayedTime === null && currentPartId === 0) {
            this.firstPartPlayedTime = Date.now();
            const latency = this.firstPartPlayedTime - this.firstPartReceivedTime;
            console.log(`[DaisysAudioPlayer] ⚡ First audio playing! Latency: ${latency}ms`);
        }
        
        console.log(`[DaisysAudioPlayer] Playing part ${currentPartId}, remaining duration: ${this.totalAudioDuration.toFixed(2)}s`);
    }

    endStream() {
        console.log('[DaisysAudioPlayer] Stream ended - Summary:', {
            minPartId: this.minPartId,
            maxPartId: this.maxPartId,
            nextPartToPlay: this.nextPartToPlay,
            remainingInQueue: Array.from(this.partQueue.keys()).sort((a,b) => a-b),
            isPlaying: this.isPlaying
        });
        // Let current part finish playing
        // The onended handler will take care of cleanup
    }

    stop() {
        console.log('[DaisysAudioPlayer] Stopping playback');
        
        if (this.activeSource) {
            try {
                this.activeSource.stop();
                this.activeSource.disconnect();
            } catch (e) {
                // Source might have already stopped
            }
            this.activeSource = null;
        }
        
        this.isPlaying = false;
        this.partQueue.clear();
        this.nextPartToPlay = null;
        this.totalAudioDuration = 0;
        this.minPartId = null;
        this.maxPartId = null;
    }
    
    cleanupOldParts() {
        // Only clean up if we're really running out of space
        if (this.partQueue.size < this.maxQueueSize - 5) {
            return; // Still have plenty of space
        }
        
        // Remove parts that are too far behind current playback position
        const partsToRemove = [];
        const maxPartsBehind = 10; // Keep more parts behind to avoid aggressive cleanup
        
        for (const [partId, buffer] of this.partQueue.entries()) {
            if (partId < this.nextPartToPlay - maxPartsBehind) {
                partsToRemove.push(partId);
                this.totalAudioDuration -= buffer.duration;
            }
        }
        
        for (const partId of partsToRemove) {
            this.partQueue.delete(partId);
            console.log(`[DaisysAudioPlayer] Cleaned up old part ${partId}`);
        }
    }
    
    getMemoryStats() {
        return {
            queueSize: this.partQueue.size,
            totalDuration: this.totalAudioDuration,
            nextPartToPlay: this.nextPartToPlay,
            isPlaying: this.isPlaying
        };
    }
}