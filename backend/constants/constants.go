package constants

type LogLevel string

const (
	LogLevelTrace   LogLevel = "trace"
	LogLevelDebug   LogLevel = "debug"
	LogLevelInfo    LogLevel = "info"
	LogLevelWarning LogLevel = "warning"
	LogLevelError   LogLevel = "error"
	LogLevelFatal   LogLevel = "fatal"
)

const (
	CtxKeyRootTempDir = "rootTempDir"
	CtxAppName        = "appName"
	CtxSessionID      = "sessionId"
	CtxFFmpegPath     = "ffmpegPath"
	CtxFFprobePath    = "ffprobePath"
	CtxRealesrganPath = "realesrganPath"
)

const (
	FileTypeEmbedFFMPEG     = "ffmpeg"
	FileTypeEmbedRealesrgan = "realesrgan"
)
