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
  console.log('🧹 Output directories cleaned.');
}

async function extractMediaEveryNSeconds(videoPath, outputDir, intervalSeconds = 10) {
  cleanOutput(outputDir);

  const framesDir = path.join(outputDir, 'frames');
  const audioDir = path.join(outputDir, 'audio');

  const duration = await new Promise((resolve, reject) => {
    ffmpeg.ffprobe(videoPath, (err, metadata) => {
      if (err) return reject(err);
      resolve(Math.floor(metadata.format.duration));
    });
  });

  const audioPromises = [];
  for (let i = 0; i < duration; i += intervalSeconds) {
    const audioOutput = path.join(audioDir, `audio_${i}.mp3`);
    const p = new Promise((res, rej) => {
      ffmpeg(videoPath)
        .setStartTime(i)
        .setDuration(intervalSeconds)
        .output(audioOutput)
        .on('end', res)
        .on('error', rej)
        .run();
    });
    audioPromises.push(p);
  }

  const framePromise = new Promise((res, rej) => {
    ffmpeg(videoPath)
      .outputOptions(['-vf', `fps=1/${intervalSeconds}`])
      .output(path.join(framesDir, 'frame-%04d.jpg'))
      .on('end', res)
      .on('error', rej)
      .run();
  });

  await Promise.all([framePromise, ...audioPromises]);

  return { framesDir, audioDir };
}

module.exports = { extractMediaEveryNSeconds, cleanOutput };