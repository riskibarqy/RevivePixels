package backend

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	config "github.com/riskibarqy/RevivePixels/backend/confiig"
	"github.com/riskibarqy/RevivePixels/backend/datatransfers"
	"github.com/riskibarqy/RevivePixels/backend/models"
	"github.com/riskibarqy/RevivePixels/backend/utils"

	"github.com/google/uuid"
)

type VideoUpscalerUsecase interface {
	ExtractAudio(ctx context.Context, params *datatransfers.VideoUpscalerRequest) error
	ExtractVideoFrames(ctx context.Context, frameDir, videoPath string, startFrame, frameCount, scaleMultiplier int, videoMetadata *datatransfers.FFProbeStreamsMetadataResponse) error
	GetVideoMetadata(ctx context.Context, inputPath string) (*datatransfers.FFProbeStreamsMetadataResponse, error)
	MergeVideos(ctx context.Context, videoPaths []string, params *datatransfers.VideoUpscalerRequest) error
	ReassembleVideo(ctx context.Context, frameDir, outputPath string, params *datatransfers.VideoUpscalerRequest) error
	UpscaleFrames(ctx context.Context, frames []string, frameDir string, params *datatransfers.VideoUpscalerRequest) error
	UpscaleVideoWithRealESRGAN(ctx context.Context, params *datatransfers.VideoUpscalerRequest) error
}

type videoUpscalerUsecase struct {
	logger      *utils.CustomLogger
	sessionApps *sync.Map // Store sessionApps reference
}

func NewVideoUpscaler(logger *utils.CustomLogger, sessionApps *sync.Map) VideoUpscalerUsecase {

	return &videoUpscalerUsecase{
		logger:      logger,
		sessionApps: sessionApps,
	}
}

// runCommand executes a shell command and hides the Windows CMD window.
func runCommand(cmd *exec.Cmd) error {
	utils.HideWindowsCMD(cmd)
	return cmd.Run()
}

// GetVideoMetadata returns the number of frames and FPS of a video.
func (u *videoUpscalerUsecase) GetVideoMetadata(ctx context.Context, inputPath string) (*datatransfers.FFProbeStreamsMetadataResponse, error) {
	cmd := exec.CommandContext(ctx, config.Paths.FFprobePath, "-v", "error", "-select_streams", "v:0",
		"-show_entries", "stream=nb_frames,r_frame_rate,width,height", "-of", "json", inputPath)
	utils.HideWindowsCMD(cmd)

	output, err := cmd.Output()
	if err != nil {
		return nil, err
	}

	var probe models.FFProbeOutput
	if err := json.Unmarshal(output, &probe); err != nil {
		return nil, err
	}

	nbFrames, _ := strconv.Atoi(probe.Streams[0].NbFrames)
	frameRateParts := strings.Split(probe.Streams[0].RFrameRate, "/")

	// Convert "30/1" to 30 FPS
	numerator, _ := strconv.Atoi(frameRateParts[0])
	denominator, _ := strconv.Atoi(frameRateParts[1])
	fps := numerator / denominator

	u.logger.Info(fmt.Sprintf("ℹ️ Video has %d frames at %d FPS", nbFrames, fps))

	return &datatransfers.FFProbeStreamsMetadataResponse{
		TotalFrames: nbFrames,
		FPS:         fps,
		Width:       probe.Streams[0].Width,
		Height:      probe.Streams[0].Height,
	}, nil
}

// ExtractVideoFrames extracts a batch of frames from the video to reduce memory usage
func (u *videoUpscalerUsecase) ExtractVideoFrames(ctx context.Context, frameDir, videoPath string, startFrame, frameCount, scaleMultiplier int, videoMetadata *datatransfers.FFProbeStreamsMetadataResponse) error {
	// If either dimension is below 360, do not rescale
	if videoMetadata.Width < 360 || videoMetadata.Height < 360 {
		scaleMultiplier = 1 // No scaling
	} else {
		// Ensure scale is ≤ 2 by dividing iteratively
		for scaleMultiplier > 2 {
			scaleMultiplier /= 2
		}
	}

	// Construct scale filter only if needed
	scaleFilter := ""
	if scaleMultiplier > 1 {
		scaleFilter = fmt.Sprintf("scale='if(gt(iw,360),iw/%d,iw)':'if(gt(ih,360),ih/%d,ih)':force_original_aspect_ratio=decrease", scaleMultiplier, scaleMultiplier)
	}

	outputPattern := filepath.Join(frameDir, "frame_%04d.png")
	cmdArgs := []string{
		"-i", videoPath,
		"-vf", fmt.Sprintf("select=between(n\\,%d\\,%d)%s", startFrame, startFrame+frameCount-1,
			func() string {
				if scaleFilter != "" {
					return "," + scaleFilter
				}
				return ""
			}()),
		"-fps_mode", "vfr",
		outputPattern,
	}
	cmd := exec.CommandContext(ctx, config.Paths.FFmpegPath, cmdArgs...)

	// Capture error output
	var stderr bytes.Buffer
	cmd.Stderr = &stderr

	err := runCommand(cmd)
	if err != nil {
		u.logger.Error(stderr.String())
		return fmt.Errorf("error extracting frames: %v", err)
	}

	return nil
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

	cmd := exec.CommandContext(ctx, config.Paths.FFmpegPath, "-i", params.TempFilePath, "-vn", "-acodec", "copy", params.TempDir+"/"+params.AudioFileName)
	return runCommand(cmd)
}

// hasAudioStream checks if a video contains an audio stream
func (u *videoUpscalerUsecase) hasAudioStream(ctx context.Context, videoPath string) (bool, error) {
	cmd := exec.CommandContext(ctx, config.Paths.FFprobePath, "-i", videoPath, "-show_streams", "-select_streams", "a", "-loglevel", "error")
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
	semaphore := make(chan struct{}, runtime.NumCPU()/2) // Max concurrent processes
	errChan := make(chan error, len(frames))             // Collect errors

	var processedFrames int32 = 0 // Track number of completed frames
	totalFrames := len(frames)

	// Calculate progress range per batch
	progressStart := 15
	progressEnd := 85
	progressRange := progressEnd - progressStart

	// Per-batch progress increase
	batchProgress := float64(progressRange) / float64(params.TotalBatches)

	// Progress range for the current batch
	batchStart := progressStart + int(batchProgress*float64(params.CurrentBatch-1))
	batchEnd := batchStart + int(batchProgress)

	progressStep := int32(math.Max(1, float64(totalFrames)/20)) // Log progress every ~5%

	for _, frame := range frames {
		wg.Add(1)
		go func(frame string) {
			defer wg.Done()
			semaphore <- struct{}{}        // Acquire slot
			defer func() { <-semaphore }() // Release slot

			outputFrame := filepath.Join(frameDir, "upscaled_"+filepath.Base(frame))
			cmd := exec.CommandContext(ctx, config.Paths.RealEsrganPath,
				"-i", frame,
				"-o", outputFrame,
				"-s", fmt.Sprintf("%d", params.ScaleMultiplier),
				"-t", "0", /* tile size (>=32/0=auto, default=0) can be 0,0,0 for multi-gpu */
				"-n", params.Model,
				"-g", "0", /* gpu device to use (default=auto) can be 0,1,2 for multi-gpu */
				"-j", "2:2:2", /* thread count for load/proc/save (default=1:2:2) can be 1:2,2,2:2 for multi-gpu */
				" --fp16",
			)

			if err := runCommand(cmd); err != nil {
				errChan <- fmt.Errorf("failed to upscale frame %s: %w", frame, err)
			}

			// Update Progress (Per-Batch Scaling)
			completed := atomic.AddInt32(&processedFrames, 1)
			if completed%progressStep == 0 || completed == int32(totalFrames) {
				progress := batchStart + int((float64(completed)/float64(totalFrames))*(float64(batchEnd-batchStart)))
				params.LoadingProgress = progress

				u.logger.Trace(fmt.Sprintf("Loading-%d - %s", params.LoadingProgress, params.InputFullFileName))
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

	cmd := exec.CommandContext(ctx, config.Paths.FFmpegPath,
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
	cmd := exec.CommandContext(ctx, config.Paths.FFmpegPath, cmdArgs...)
	return runCommand(cmd)
}

// ✅ Upscaling function using Real-ESRGAN with batch processing
func (u *videoUpscalerUsecase) UpscaleVideoWithRealESRGAN(ctx context.Context, params *datatransfers.VideoUpscalerRequest) error {
	startTime := time.Now() // Track overall process start time
	params.LoadingProgress = 0

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

	params.LoadingProgress += 5
	u.logger.Trace(fmt.Sprintf("Loading-%d - %s", params.LoadingProgress, params.InputFullFileName)) // ✅ 5% - Initial setup done

	u.logger.Info("Getting video details")
	// Get total frames and FPS
	videoMetaData, err := u.GetVideoMetadata(ctx, params.TempFilePath)
	if err != nil {
		return fmt.Errorf("error getting video details: %v", err)
	}

	params.LoadingProgress += 5
	u.logger.Trace(fmt.Sprintf("Loading-%d - %s", params.LoadingProgress, params.InputFullFileName)) // ✅ 10% - Retrieved video details

	// Ensure FPS is set
	if params.VideoFPS == 0 {
		params.VideoFPS = videoMetaData.FPS
	}

	params.AudioFileName = fmt.Sprintf("%s.aac", params.InputPlainFileName) // Extract audio if available
	u.logger.Info("Extract audio from the video")
	if err := u.ExtractAudio(ctx, params); err != nil {
		return fmt.Errorf("error extracting audio: %v", err)
	}

	params.LoadingProgress += 5
	u.logger.Trace(fmt.Sprintf("Loading-%d - %s", params.LoadingProgress, params.InputFullFileName)) // ✅ 15% - Extracted audio

	// Process in batches
	batchSize := 150
	tempVideos := []string{}
	totalFrames := videoMetaData.TotalFrames
	totalBatches := (totalFrames + batchSize - 1) / batchSize
	params.TotalBatches = totalBatches

	for i := 0; i < totalFrames; i += batchSize {
		batchStartTime := time.Now() // Track time per batch

		uuid := uuid.New().String()
		endFrame := i + batchSize - 1
		if endFrame >= totalFrames {
			endFrame = totalFrames - 1
		}

		batchFrameDir := filepath.Join(filepath.Dir(params.TempFilePath), fmt.Sprintf("batch_%s", uuid))
		if err := os.MkdirAll(batchFrameDir, os.ModePerm); err != nil {
			return fmt.Errorf("failed to create batch directory: %v", err)
		}

		u.logger.Info(fmt.Sprintf("🔄 Processing frames %d - %d", i+1, endFrame+1))

		// Extract frames
		if err := u.ExtractVideoFrames(ctx, batchFrameDir, params.TempFilePath, i, endFrame-i+1, params.ScaleMultiplier, videoMetaData); err != nil {
			return fmt.Errorf("error extracting batch: %v", err)
		}

		// Get list of extracted frames
		frames, err := filepath.Glob(filepath.Join(batchFrameDir, "*.png"))
		sort.Strings(frames)
		if err != nil || len(frames) == 0 {
			return fmt.Errorf("no frames found in %s", batchFrameDir)
		}

		params.CurrentBatch = (i / batchSize) + 1

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

		// Dynamic ETA Calculation
		processedFrames := endFrame + 1
		elapsedTime := time.Since(startTime).Seconds()
		remainingFrames := totalFrames - processedFrames

		avgTimePerFrame := elapsedTime / float64(processedFrames)
		estimatedRemainingTime := time.Duration(avgTimePerFrame * float64(remainingFrames) * float64(time.Second))

		batchElapsed := time.Since(batchStartTime).Seconds()
		u.logger.Info(fmt.Sprintf("🔄 Batch %d/%d completed in %.2fs. ETA: %s", (i/batchSize)+1, (totalFrames/batchSize)+1, batchElapsed, estimatedRemainingTime.Round(time.Second)))
	}

	params.LoadingProgress += 5
	u.logger.Trace(fmt.Sprintf("Loading-%d - %s", params.LoadingProgress, params.InputFullFileName)) // ✅ 85% - Finished processing all batches

	u.logger.Info("Merging video")
	// Merge all batch videos into the final video
	if err := u.MergeVideos(ctx, tempVideos, params); err != nil {
		return fmt.Errorf("error merging final video: %v", err)
	}

	params.LoadingProgress += 5
	u.logger.Trace(fmt.Sprintf("Loading-%d - %s", params.LoadingProgress, params.InputFullFileName)) // ✅ 95% - Merging done, starting cleanup

	u.logger.Info("Cleaning temp files")
	u.logger.Info("Cleaning " + params.TempDir)

	// Cleanup temp batch videos
	os.RemoveAll(params.TempDir)

	params.LoadingProgress += 5
	u.logger.Trace(fmt.Sprintf("Loading-%d - %s", params.LoadingProgress, params.InputFullFileName)) // ✅ 100% - Process complete
	totalElapsed := time.Since(startTime).Seconds()
	u.logger.Info(fmt.Sprintf("✅ Upscaling completed successfully in %dm%.2fs!", int(totalElapsed/60), totalElapsed))

	return nil
}
