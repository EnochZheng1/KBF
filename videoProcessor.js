// videoProcessor.js
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const fs = require('fs');
const path = require('path');

ffmpeg.setFfmpegPath(ffmpegPath);

function cleanOutput(outputDir) {
    const subDirs = ['frames', 'audio'];
    for (const sub of subDirs) {
        const fullPath = path.join(outputDir, sub);
        if (fs.existsSync(fullPath)) {
            fs.rmSync(fullPath, { recursive: true, force: true });
        }
        fs.mkdirSync(fullPath, { recursive: true });
    }
    console.log('[videoProcessor] 🧹 Output directories cleaned.');
}

async function extractMediaEveryNSeconds(videoPath, outputDir, intervalSeconds = 60) {
    cleanOutput(outputDir);

    const framesDir = path.join(outputDir, 'frames');
    const audioDir = path.join(outputDir, 'audio');

    const duration = await new Promise((resolve, reject) => {
        ffmpeg.ffprobe(videoPath, (err, metadata) => {
            if (err) return reject(err);
            const videoDuration = Math.ceil(metadata.format.duration);
            console.log(`[videoProcessor] 🎥 Video duration detected: ${videoDuration} seconds.`);
            resolve(videoDuration);
        });
    });

    if (duration === 0) {
        console.log('[videoProcessor] ⚠️ Warning: Video duration is 0. No frames or audio will be extracted.');
        return { framesDir, audioDir };
    }

    const audioPromises = [];
    for (let i = 0; i < duration; i += intervalSeconds) {
        const audioOutput = path.join(audioDir, `audio_${String(i).padStart(4, '0')}.mp3`);
        const clipDuration = Math.min(intervalSeconds, duration - i);

        const p = new Promise((resolve) => {
            ffmpeg(videoPath)
                .setStartTime(i)
                .setDuration(clipDuration)
                .output(audioOutput)
                .on('end', resolve)
                .on('error', (err) => {
                    console.error(`[videoProcessor] ❌ Error processing audio clip at ${i}s:`, err.message);
                    resolve(); // Don't fail the whole process
                })
                .run();
        });
        audioPromises.push(p);
    }
    
    const effectiveInterval = Math.min(intervalSeconds, duration > 0 ? duration : intervalSeconds);
    const frameRate = 1 / effectiveInterval;

    const framePromise = new Promise((resolve) => {
        ffmpeg(videoPath)
            .outputOptions(['-vf', `fps=${frameRate}`])
            .output(path.join(framesDir, 'frame-%04d.jpg'))
            .on('end', resolve)
            .on('error', (err) => {
                console.error('[videoProcessor] ❌ Error during frame extraction:', err.message);
                resolve();
            })
            .run();
    });

    await Promise.all([framePromise, ...audioPromises]);

    console.log('[videoProcessor] 🏁 All ffmpeg processes finished.');
    return { framesDir, audioDir };
}

module.exports = { extractMediaEveryNSeconds, cleanOutput };