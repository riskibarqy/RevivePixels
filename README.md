# Go Upscaler

Go Upscaler is a video upscaling application built using Wails (Go) and ReactJS. It utilizes Real-ESRGAN for high-quality video upscaling.

## Prerequisites

Before running the application, ensure you have the following dependencies installed:

1. **FFmpeg**  
   - Required for handling video encoding and decoding.  
   - [Download FFmpeg](https://ffmpeg.org/download.html)  
   - Add FFmpeg to your system's PATH.

2. **cvnn Vulkan**  
   - Needed for Real-ESRGAN processing with Vulkan acceleration.  
   - [Download ncnn-vulkan](https://github.com/nihui/realsr-ncnn-vulkan/releases)  

## Installation

1. Clone the repository:

```sh
git clone https://github.com/riskibarqy/go-upscaler.git
cd go-upscaler
```
2. Install Go Dependencies  
```sh
go mod tidy  
```
3. Install Frontend Dependencies
```sh
cd frontend  
npm install  
```

## Running the Application

Start the Development Server
```sh
wails dev 
```

## Build the Application  
```sh
wails build
```

Features
High-quality video upscaling using Real-ESRGAN
Cross-platform support (Windows, macOS, Linux)
Wails-based UI for seamless integration