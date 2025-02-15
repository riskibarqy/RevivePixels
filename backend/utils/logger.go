package utils

import (
	"fmt"
	"os"
	"time"
)

// CustomLogger implements Wails' CustomLogger interface
type CustomLogger struct {
	file *os.File
}

// NewCustomLogger initializes a new custom logger
func NewCustomLogger(logFile string) (*CustomLogger, error) {
	file, err := os.OpenFile(logFile, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0666)
	if err != nil {
		return nil, err
	}

	return &CustomLogger{file: file}, nil
}

// Implement Wails' logger interface
func (l *CustomLogger) Print(message string)   { l.log("[LOG]", message) }
func (l *CustomLogger) Trace(message string)   { l.log("[TRACE]", message) }
func (l *CustomLogger) Debug(message string)   { l.log("[DEBUG]", message) }
func (l *CustomLogger) Info(message string)    { l.log("[INFO]", message) }
func (l *CustomLogger) Warning(message string) { l.log("[WARNING]", message) }
func (l *CustomLogger) Error(message string)   { l.log("[ERROR]", message) }
func (l *CustomLogger) Fatal(message string) {
	l.log("[FATAL]", message)
	os.Exit(1)
}

// Internal logging function
func (l *CustomLogger) log(level string, message string) {
	logEntry := level + " " + time.Now().Format("2006-01-02T15:04:05.000Z") + " > " + message + "\n"
	l.file.WriteString(logEntry)
	fmt.Fprintln(os.Stderr, logEntry)
}

// Close closes the log file
func (l *CustomLogger) Close() {
	l.file.Close()
}
