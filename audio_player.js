// Audio player window for hotkey-triggered summaries

let audioContext = null;
let chunkPlayer = null;
let isPlayingStream = false;

// Get URL parameters
const urlParams = new URLSearchParams(window.location.search);
const mode = urlParams.get('mode'); // 'streaming' or 'url'
const audioUrl = urlParams.get('url');

document.addEventListener('DOMContentLoaded', async () => {
    const statusDiv = document.getElementById('status');
    const stopBtn = document.getElementById('stop-btn');
    const audioPlayer = document.getElementById('audio-player');
    const audioIcon = document.getElementById('audio-icon');
    
    // Handle stop button
    stopBtn.addEventListener('click', async () => {
        if (mode === 'streaming') {
            await chrome.runtime.sendMessage({ action: 'stopStreaming' });
            if (chunkPlayer) {
                chunkPlayer.stop();
            }
        } else {
            audioPlayer.pause();
            audioPlayer.currentTime = 0;
        }
        // Pause all wave animations
        document.querySelectorAll('#audio-icon > div').forEach(wave => {
            wave.classList.add('wave-paused');
        });
        statusDiv.innerHTML = 'Stopped';
        setTimeout(() => window.close(), 500);
    });
    
    // Handle URL-based audio
    if (mode === 'url' && audioUrl) {
        try {
            statusDiv.innerHTML = 'Playing audio...';
            audioPlayer.src = decodeURIComponent(audioUrl);
            await audioPlayer.play();
            stopBtn.classList.remove('hidden');
            
            audioPlayer.onended = () => {
                statusDiv.innerHTML = '<span class="success">✓ Complete</span>';
                // Pause all wave animations
                document.querySelectorAll('#audio-icon > div').forEach(wave => {
                    wave.classList.add('wave-paused');
                });
                // Don't auto-close, let user control
            };
        } catch (error) {
            statusDiv.innerHTML = '<span class="error">✗ Error playing audio</span>';
            // Pause all wave animations
            document.querySelectorAll('#audio-icon > div').forEach(wave => {
                wave.classList.add('wave-paused');
            });
            // Don't auto-close on error either
        }
    } else if (mode === 'streaming') {
        statusDiv.innerHTML = '<span class="spinner"></span><span>Connecting...</span>';
        isPlayingStream = true;
        stopBtn.classList.remove('hidden');
    }
    
    // Listen for streaming messages
    chrome.runtime.onMessage.addListener(handleStreamingMessage);
    
    // Listen for new audio requests
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.action === 'stopAudio') {
            // Stop current audio
            if (mode === 'streaming' && chunkPlayer) {
                chunkPlayer.stop();
            } else if (audioPlayer.src) {
                audioPlayer.pause();
                audioPlayer.currentTime = 0;
            }
            // Pause animations
            document.querySelectorAll('#audio-icon > div').forEach(wave => {
                wave.classList.add('wave-paused');
            });
        } else if (message.action === 'newAudio') {
            // Stop current audio first
            if (mode === 'streaming' && chunkPlayer) {
                chunkPlayer.stop();
            } else if (audioPlayer.src) {
                audioPlayer.pause();
                audioPlayer.currentTime = 0;
            }
            
            // Handle new audio
            if (message.mode === 'url' && message.audioUrl) {
                statusDiv.textContent = 'Playing audio...';
                audioPlayer.src = message.audioUrl;
                audioPlayer.play().catch(err => {
                    statusDiv.textContent = 'Error playing audio';
                });
            } else if (message.mode === 'streaming') {
                statusDiv.innerHTML = '<span class="spinner"></span><span>Connecting...</span>';
                isPlayingStream = true;
                stopBtn.classList.remove('hidden');
            }
        }
    });
});

async function handleStreamingMessage(message) {
    const statusDiv = document.getElementById('status');
    const stopBtn = document.getElementById('stop-btn');
    const audioIcon = document.getElementById('audio-icon');
    
    if (message.action === 'streamingStatus') {
        statusDiv.innerHTML = `Status: ${message.status}`;
    } else if (message.action === 'streamingMessage') {
        if (message.type === 'status') {
            if (message.data.status === 'started') {
                statusDiv.innerHTML = 'Playing summary...';
            }
        } else if (message.type === 'audioChunk') {
            // Initialize audio context if needed
            if (!audioContext) {
                audioContext = new (window.AudioContext || window.webkitAudioContext)();
                
                // Resume context if suspended
                if (audioContext.state === 'suspended') {
                    await audioContext.resume();
                }
                
                // Dynamically import DaisysAudioPlayer
                const module = await import('./daisys_audio_player.js');
                const DaisysAudioPlayer = module.DaisysAudioPlayer;
                chunkPlayer = new DaisysAudioPlayer(audioContext);
            }
            
            // Play audio chunk
            if (message.audioData && chunkPlayer && message.metadata) {
                try {
                    // Convert array back to ArrayBuffer
                    const audioBuffer = new Uint8Array(message.audioData).buffer;
                    
                    // Add part to player
                    await chunkPlayer.addPart(message.metadata.part_id, audioBuffer);
                    
                    statusDiv.innerHTML = 'Playing summary...';
                    // Remove pause state from all waves
                    document.querySelectorAll('#audio-icon > div').forEach(wave => {
                        wave.classList.remove('wave-paused');
                    });
                } catch (error) {
                    console.error('Error playing audio chunk:', error);
                }
            }
        }
    } else if (message.action === 'streamingComplete') {
        if (chunkPlayer) {
            chunkPlayer.endStream();
            
            // Wait for all audio to finish playing
            const checkPlaybackComplete = setInterval(() => {
                const stats = chunkPlayer.getMemoryStats();
                
                // Check if all parts have been played
                if (!stats.isPlaying && stats.queueSize === 0) {
                    clearInterval(checkPlaybackComplete);
                    statusDiv.innerHTML = '<span class="success">✓ Complete</span>';
                    // Pause all wave animations
                    document.querySelectorAll('#audio-icon > div').forEach(wave => {
                        wave.classList.add('wave-paused');
                    });
                    // Don't auto-close, let user control
                }
            }, 100);
            
            // Timeout fallback
            setTimeout(() => {
                clearInterval(checkPlaybackComplete);
                statusDiv.innerHTML = '<span class="success">✓ Complete</span>';
                // Pause all wave animations
                document.querySelectorAll('#audio-icon > div').forEach(wave => {
                    wave.classList.add('wave-paused');
                });
            }, 30000);
        }
    } else if (message.action === 'streamingError') {
        console.error('Streaming error:', message.error);
        statusDiv.innerHTML = '<span class="error">✗ Error</span>';
        // Pause all wave animations
        document.querySelectorAll('#audio-icon > div').forEach(wave => {
            wave.classList.add('wave-paused');
        });
        // Don't auto-close on error
    }
}