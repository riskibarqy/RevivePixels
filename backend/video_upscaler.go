package backend

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"

	"github.com/riskibarqy/go-upscaler/backend/datatransfers"
	"github.com/riskibarqy/go-upscaler/backend/models"
	"github.com/riskibarqy/go-upscaler/backend/utils"

	"github.com/google/uuid"
)

type VideoUpscalerUsecase interface {
	ExtractAudio(ctx context.Context, params *datatransfers.VideoUpscalerRequest) error
	ExtractVideoFrames(ctx context.Context, frameDir, videoPath string, startFrame, frameCount int) error
	GetVideoFrames(ctx context.Context, inputPath string) (int, int, error)
	MergeVideos(ctx context.Context, videoPaths []string, params *datatransfers.VideoUpscalerRequest) error
	ReassembleVideo(ctx context.Context, frameDir, outputPath string, params *datatransfers.VideoUpscalerRequest) error
	UpscaleFrames(ctx context.Context, frames []string, frameDir string, params *datatransfers.VideoUpscalerRequest) error
	UpscaleVideoWithRealESRGAN(ctx context.Context, params *datatransfers.VideoUpscalerRequest) error
}

type videoUpscalerUsecase struct {
	logger *utils.CustomLogger
}

func NewVideoUpscaler(logger *utils.CustomLogger) VideoUpscalerUsecase {
	return &videoUpscalerUsecase{
		logger: logger,
	}
}

// runCommand executes a shell command and hides the Windows CMD window.
func runCommand(cmd *exec.Cmd) error {
	utils.HideWindowsCMD(cmd)
	return cmd.Run()
}

// ExtractVideoFrames extracts a batch of frames from the video to reduce memory usage
func (u *videoUpscalerUsecase) ExtractVideoFrames(ctx context.Context, frameDir, videoPath string, startFrame, frameCount int) error {
	outputPattern := filepath.Join(frameDir, "frame_%04d.png")
	cmd := exec.CommandContext(ctx, "ffmpeg",
		"-i", videoPath,
		"-vf", fmt.Sprintf("select=between(n\\,%d\\,%d)", startFrame, startFrame+frameCount-1),
		"-vsync", "vfr",
		outputPattern,
	)

	// Capture error output
	var stderr bytes.Buffer
	cmd.Stderr = &stderr

	err := runCommand(cmd)
	if err != nil {
		return fmt.Errorf("error extracting frames: %v", err)
	}

	return nil
}

// GetVideoFrames returns the number of frames and FPS of a video.
func (u *videoUpscalerUsecase) GetVideoFrames(ctx context.Context, inputPath string) (int, int, error) {
	cmd := exec.CommandContext(ctx, "ffprobe", "-v", "error", "-select_streams", "v:0",
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

	u.logger.Info(fmt.Sprintf("ℹ️ Video has %d frames at %d FPS", nbFrames, fps))

	return nbFrames, fps, nil
}

// ExtractAudio extracts the audio track from a video if available.
func (u *videoUpscalerUsecase) ExtractAudio(ctx context.Context, params *datatransfers.VideoUpscalerRequest) error {
	hasAudio, err := u.hasAudioStream(ctx, params.TempFilePath)
	if err != nil {
		return err
	}

	params.IsHaveAudio = hasAudio

	if !params.IsHaveAudio {
		return nil
	}

	cmd := exec.CommandContext(ctx, "ffmpeg", "-i", params.TempFilePath, "-vn", "-acodec", "copy", params.TempDir+"/"+params.AudioFileName)
	return runCommand(cmd)
}

// hasAudioStream checks if a video contains an audio stream
func (u *videoUpscalerUsecase) hasAudioStream(ctx context.Context, videoPath string) (bool, error) {
	cmd := exec.CommandContext(ctx, "ffprobe", "-i", videoPath, "-show_streams", "-select_streams", "a", "-loglevel", "error")
	utils.HideWindowsCMD(cmd)
	output, err := cmd.Output()
	if err != nil {
		return false, err
	}
	return len(output) > 0, nil
}

// UpscaleFrames processes multiple frames in parallel using Real-ESRGAN.
func (u *videoUpscalerUsecase) UpscaleFrames(ctx context.Context, frames []string, frameDir string, params *datatransfers.VideoUpscalerRequest) error {
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
			cmd := exec.CommandContext(ctx, "realesrgan-ncnn-vulkan",
				"-i", frame,
				"-o", outputFrame,
				"-s", "2",
				"-t", "1024",
				"-g", "0",
				"-j", "16:16:16",
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
		if !utils.IgnoreError(err.Error()) {
			allErrors = append(allErrors, err.Error())
		}
	}

	if len(allErrors) > 0 {
		return fmt.Errorf("errors occurred during upscaling:\n%s", strings.Join(allErrors, "\n"))
	}

	return nil
}

// ReassembleVideo reassembles frames into a video and adds audio if available.
func (u *videoUpscalerUsecase) ReassembleVideo(ctx context.Context, frameDir, outputPath string, params *datatransfers.VideoUpscalerRequest) error {
	u.logger.Info("Reassembling video per frame")

	framePattern := filepath.Join(frameDir, "upscaled_frame_%04d.png")
	files, err := filepath.Glob(filepath.Join(frameDir, "*.png"))
	if err != nil || len(files) == 0 {
		return fmt.Errorf("no upscaled frames found in %s", frameDir)
	}

	cmd := exec.CommandContext(ctx, "ffmpeg",
		"-framerate", fmt.Sprintf("%d", params.VideoFPS),
		"-i", framePattern,
		"-c:v", "libx264",
		"-crf", "18",
		"-pix_fmt", "yuv420p",
		outputPath,
	)

	return runCommand(cmd)
}

// MergeVideos merging reassemble video to one and add adds audio if available.
func (u *videoUpscalerUsecase) MergeVideos(ctx context.Context, videoPaths []string, params *datatransfers.VideoUpscalerRequest) error {
	listFile := filepath.Join(filepath.Dir(params.TempDir), "video_list.txt")
	file, err := os.Create(listFile)
	if err != nil {
		return fmt.Errorf("failed to create list file: %v", err)
	}
	defer file.Close()

	// Ensure correct path formatting for FFmpeg (Windows compatibility)
	for _, path := range videoPaths {
		_, _ = file.WriteString(fmt.Sprintf("file '%s'\n", strings.ReplaceAll(path, "\\", "/")))
	}

	// Build FFmpeg command
	cmdArgs := []string{"-f", "concat", "-safe", "0", "-i", listFile}

	// If audio exists, add audio file (ensure it's properly formatted)
	if params.IsHaveAudio {
		audioPath := filepath.Join(params.TempDir, params.AudioFileName)
		cmdArgs = append(cmdArgs, "-i", audioPath)
	}

	// Set codecs AFTER all inputs
	cmdArgs = append(cmdArgs, "-c:v", "copy")

	if params.IsHaveAudio {
		cmdArgs = append(cmdArgs, "-c:a", "aac") // Ensure correct AAC encoding
	}

	// Output file path
	cmdArgs = append(cmdArgs, "-y", params.SavePath) // "-y" forces overwrite

	// Execute command
	cmd := exec.CommandContext(ctx, "ffmpeg", cmdArgs...)
	return runCommand(cmd)
}

// ✅ Upscaling function using Real-ESRGAN with batch processing
func (u *videoUpscalerUsecase) UpscaleVideoWithRealESRGAN(ctx context.Context, params *datatransfers.VideoUpscalerRequest) error {
	u.logger.Info(fmt.Sprintf("🚀 Starting upscale: %s with model: %s", params.InputFullFileName, params.Model))

	// Check if input file exists
	if _, err := os.Stat(params.TempFilePath); os.IsNotExist(err) {
		return fmt.Errorf("file not found: %s", params.TempFilePath)
	}

	// Create a temporary directory for storing batch videos
	tempVideoDir := filepath.Join(filepath.Dir(params.TempFilePath), "temp_videos")
	if err := os.MkdirAll(tempVideoDir, os.ModePerm); err != nil {
		return fmt.Errorf("failed to create temp video directory: %v", err)
	}

	u.logger.Info("Getting video details")
	// Get total frames and FPS
	totalFrames, videoFPS, err := u.GetVideoFrames(ctx, params.TempFilePath)
	if err != nil {
		return fmt.Errorf("error getting video details: %v", err)
	}

	// Ensure FPS is set
	if params.VideoFPS == 0 {
		params.VideoFPS = videoFPS
	}

	params.AudioFileName = fmt.Sprintf("%s.aac", params.InputPlainFileName) // Extract audio if available
	u.logger.Info("Extract audio from the video")
	if err := u.ExtractAudio(ctx, params); err != nil {
		return fmt.Errorf("error extracting audio: %v", err)
	}

	// Process in batches
	batchSize := 100
	tempVideos := []string{}

	for i := 0; i < totalFrames; i += batchSize {
		uuid := uuid.New().String()
		endFrame := i + batchSize - 1
		if endFrame >= totalFrames {
			endFrame = totalFrames - 1
		}

		batchFrameDir := filepath.Join(filepath.Dir(params.TempFilePath), fmt.Sprintf("batch_%s", uuid))
		if err := os.MkdirAll(batchFrameDir, os.ModePerm); err != nil {
			return fmt.Errorf("failed to create batch directory: %v", err)
		}

		u.logger.Info(fmt.Sprintf("🔄 Processing frames %d - %d", i, endFrame))

		// Extract frames
		if err := u.ExtractVideoFrames(ctx, batchFrameDir, params.TempFilePath, i, endFrame-i+1); err != nil {
			return fmt.Errorf("error extracting batch: %v", err)
		}

		// Get list of extracted frames
		frames, err := filepath.Glob(filepath.Join(batchFrameDir, "*.png"))
		sort.Strings(frames)
		if err != nil || len(frames) == 0 {
			return fmt.Errorf("no frames found in %s", batchFrameDir)
		}

		// Upscale frames
		if err := u.UpscaleFrames(ctx, frames, batchFrameDir, params); err != nil {
			return fmt.Errorf("error upscaling batch: %v", err)
		}
		// Create batch video
		batchVideoPath := filepath.Join(tempVideoDir, fmt.Sprintf("temp_batch_%s.mp4", uuid))

		if err := u.ReassembleVideo(ctx, batchFrameDir, batchVideoPath, params); err != nil {
			return fmt.Errorf("error reassembling batch video: %v", err)
		}

		tempVideos = append(tempVideos, batchVideoPath) // Store batch video path

		// Cleanup batch frames
		os.RemoveAll(batchFrameDir)

	}

	u.logger.Info("merging video")
	// Merge all batch videos into the final video
	if err := u.MergeVideos(ctx, tempVideos, params); err != nil {
		return fmt.Errorf("error merging final video: %v", err)
	}

	u.logger.Info("cleaning temp files")
	// Cleanup temp batch videos
	os.RemoveAll(tempVideoDir)
	os.RemoveAll(params.TempDir)

	u.logger.Info("✅ Upscaling completed successfully!")

	return nil
}
