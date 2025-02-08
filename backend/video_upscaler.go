package backend

import (
	"context"
	"encoding/json"
	"fmt"
	"go-upscaler/backend/datatransfers"
	"go-upscaler/backend/models"
	"go-upscaler/backend/utils"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
)

type VideoUpscaler struct {
	_ context.Context
}

// runCommand executes a shell command and hides the Windows CMD window.
func runCommand(cmd *exec.Cmd) error {
	cmd.Stdout, cmd.Stderr = os.Stdout, os.Stderr // Show logs
	utils.HideWindowsCMD(cmd)
	return cmd.Run()
}

// ExtractVideoFrames extracts frames from a video using FFmpeg.
func (u *VideoUpscaler) ExtractVideoFrames(frameDir, inputPath string) error {
	framePattern := filepath.Join(frameDir, "frame_%04d.png")
	cmd := exec.Command("ffmpeg", "-hwaccel", "cuda", "-i", inputPath, "-q:v", "2", framePattern)
	return runCommand(cmd)
}

// GetVideoFrames returns the number of frames and FPS of a video.
func (u *VideoUpscaler) GetVideoFrames(inputPath string) (int, int, error) {
	cmd := exec.Command("ffprobe", "-v", "error", "-select_streams", "v:0",
		"-show_entries", "stream=nb_frames,r_frame_rate", "-of", "json", inputPath)
	utils.HideWindowsCMD(cmd)
	output, err := cmd.Output()
	if err != nil {
		return 0, 0, err
	}

	var probe models.FFProbeOutput
	if err := json.Unmarshal(output, &probe); err != nil {
		return 0, 0, err
	}

	nbFrames, _ := strconv.Atoi(probe.Streams[0].NbFrames)
	frameRateParts := strings.Split(probe.Streams[0].RFrameRate, "/")

	// Convert "30/1" to 30 FPS
	numerator, _ := strconv.Atoi(frameRateParts[0])
	denominator, _ := strconv.Atoi(frameRateParts[1])
	fps := numerator / denominator

	return nbFrames, fps, nil
}

// ExtractAudio extracts the audio track from a video.
func (u *VideoUpscaler) ExtractAudio(inputPath, audioFilename string) error {
	cmd := exec.Command("ffmpeg", "-i", inputPath, "-vn", "-acodec", "copy", audioFilename)
	return runCommand(cmd)
}

// UpscaleFrames processes multiple frames in parallel using Real-ESRGAN.
func (u *VideoUpscaler) UpscaleFrames(frames []string, frameDir string, params *datatransfers.VideoUpscalerRequest) error {
	var wg sync.WaitGroup
	sem := make(chan struct{}, 4)            // Max 4 concurrent processes
	errChan := make(chan error, len(frames)) // Collect errors

	for _, frame := range frames {
		wg.Add(1)
		go func(frame string) {
			defer wg.Done()
			sem <- struct{}{}        // Acquire slot
			defer func() { <-sem }() // Release slot

			outputFrame := filepath.Join(frameDir, "upscaled_"+filepath.Base(frame))
			cmd := exec.Command("realesrgan-ncnn-vulkan",
				"-i", frame,
				"-o", outputFrame,
				"-s", "2",
				"-t", "512",
				"-g", "0",
				" --fp16",
				"-n", params.Model,
			)

			if err := runCommand(cmd); err != nil {
				errChan <- fmt.Errorf("failed to upscale frame %s: %w", frame, err)
			}
		}(frame)
	}

	wg.Wait()
	close(errChan) // Close error channel after all goroutines finish

	// Check for any errors
	var allErrors []string
	for err := range errChan {
		allErrors = append(allErrors, err.Error())
	}

	if len(allErrors) > 0 {
		return fmt.Errorf("errors occurred during upscaling:\n%s", strings.Join(allErrors, "\n"))
	}

	return nil
}

// ReassembleVideo reassembles frames into a video and adds audio.
func (u *VideoUpscaler) ReassembleVideo(frameDir string, params *datatransfers.VideoUpscalerRequest) error {
	outputPattern := filepath.Join(frameDir, "upscaled_frame_%04d.png")
	cmd := exec.Command("ffmpeg",
		"-framerate", fmt.Sprintf("%d", params.VideoFPS),
		"-i", outputPattern,
		"-i", params.AudioFileName,
		"-c:v", "libx264",
		"-crf", "18",
		"-pix_fmt", "yuv420p",
		"-fps_mode", "vfr",
		"-c:a", "copy",
		params.SavePath,
	)
	return runCommand(cmd)
}
