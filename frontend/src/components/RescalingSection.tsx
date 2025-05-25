import * as React from "react";
import { useState, useRef, useCallback, useEffect } from "react";
import { useDropzone } from "react-dropzone";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Loader2, XCircle, RotateCcw, Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import ProgressBar from "@ramonak/react-progress-bar";
import { GetVideoInfo } from "../../wailsjs/go/main/App";
import { EventsOn, EventsOff } from "../../wailsjs/runtime/runtime";

// Common video resolutions
const VIDEO_RESOLUTIONS = [
    { label: "480p (SD)", width: 854, height: 480 },
    { label: "720p (HD)", width: 1280, height: 720 },
    { label: "1080p (Full HD)", width: 1920, height: 1080 },
    { label: "1440p (2K)", width: 2560, height: 1440 },
    { label: "2160p (4K)", width: 3840, height: 2160 },
    { label: "Custom", width: 0, height: 0 },
];

// Common video formats
const VIDEO_FORMATS = ["mp4", "mkv", "avi", "mov", "webm"];

// Common video codecs
const VIDEO_CODECS = ["h264", "h265", "vp9"];

// Common frame rates - removing custom option and keeping just the standard rates
const FRAME_RATES = [
    { value: "23.976", label: "23.976 fps" },
    { value: "24", label: "24 fps" },
    { value: "25", label: "25 fps" },
    { value: "29.97", label: "29.97 fps" },
    { value: "30", label: "30 fps" },
    { value: "50", label: "50 fps" },
    { value: "59.94", label: "59.94 fps" },
    { value: "60", label: "60 fps" }
];

// Add after VIDEO_CODECS constant
const MINIMUM_BITRATES = {
    "480p": 1000,
    "720p": 2500,
    "1080p": 5000,
    "1440p": 8000,
    "2160p": 16000
};

interface VideoSettings {
    resolution: string;
    customWidth: number;
    customHeight: number;
    format: string;
    codec: string;
    bitrate: string;
    frameRate: string;
}

interface VideoInfo {
    width: number;
    height: number;
    bitrate: number;
    codec: string;
    format: string;
    frameRate: number;
    duration: number;
    totalFrames: number;
}

interface RescalingSectionProps {
    selectedFiles: File[];
    setSelectedFiles: React.Dispatch<React.SetStateAction<File[]>>;
    logs: string[];
    setLogs: React.Dispatch<React.SetStateAction<string[]>>;
}

// Add before the RescalingSection component
const isValueModified = (current: string | number, original: string | number): boolean => {
    return current.toString() !== original.toString();
};

export function RescalingSection({ selectedFiles, setSelectedFiles, logs, setLogs }: RescalingSectionProps) {
    const [processing, setProcessing] = useState(false);
    const [progressMap, setProgressMap] = useState<{ [key: string]: number }>({});
    const [thumbnails, setThumbnails] = useState<{ [key: string]: string }>({});
    const [videoSettings, setVideoSettings] = useState<{ [key: string]: VideoSettings }>({});
    const [videoInfo, setVideoInfo] = useState<{ [key: string]: VideoInfo }>({});
    const [elapsedTime, setElapsedTime] = useState(0);
    const logContainerRef = useRef<HTMLDivElement | null>(null);
    const [estimatedSizes, setEstimatedSizes] = useState<{ [key: string]: { original: string, estimated: string } }>({});

    useEffect(() => {
        if (logContainerRef.current) {
            const viewport = logContainerRef.current.querySelector('[data-radix-scroll-area-viewport]');
            if (viewport) {
                viewport.scrollTop = viewport.scrollHeight;
            }
        }
    }, [logs]);

    const getResolutionLabel = (height: number, width: number) => {
        const standardResolutions = {
            480: 'SD',
            720: 'HD',
            1080: 'Full HD',
            1440: '2K',
            2160: '4K'
        };
        return standardResolutions[height] ? `${height}p (${standardResolutions[height]})` : 'Custom';
    };

    const getClosestFrameRate = (fps: number): string => {
        // Convert fps to string with 3 decimal places for comparison
        const fpsStr = fps.toFixed(3);
        
        // First try to find an exact match
        const exactMatch = FRAME_RATES.find(rate => 
            Math.abs(parseFloat(rate.value) - parseFloat(fpsStr)) < 0.001
        );
        if (exactMatch) return exactMatch.value;

        // If no exact match, return custom
        return "custom";
    };

    const onDrop = useCallback(async (acceptedFiles) => {
        setProgressMap({});

        const updatedFiles = [...selectedFiles];
        for (const file of acceptedFiles) {
            const existingCount = updatedFiles.filter(f => f.name.startsWith(file.name.replace(/\.\w+$/, ''))).length;
            const fileExtension = file.name.substring(file.name.lastIndexOf('.'));
            const fileNameWithoutExt = file.name.replace(/\.\w+$/, '');

            const uniqueName = existingCount > 0
                ? `${fileNameWithoutExt}-(${existingCount})${fileExtension}`
                : file.name;

            const uniqueFile = new File([file], uniqueName, { type: file.type });
            updatedFiles.push(uniqueFile);
            generateThumbnail(uniqueFile);

            try {
                // Get video info from backend
                // Create a temporary URL for the file
                const fileUrl = URL.createObjectURL(file);
                const reader = new FileReader();
                
                reader.onload = async () => {
                    try {
                        const base64Data = reader.result?.toString().split(',')[1];
                        if (!base64Data) {
                            throw new Error('Failed to read file data');
                        }
                        
                        console.log('Getting video info for:', file.name);
                        const info = await GetVideoInfo(base64Data);
                        console.log('Received video info:', info);
                        
                        setVideoInfo(prev => ({
                            ...prev,
                            [uniqueFile.name]: info
                        }));

                        const resolutionLabel = getResolutionLabel(info.height, info.width);
                        const frameRate = getClosestFrameRate(info.frameRate);
                        const newSettings = {
                            resolution: resolutionLabel,
                            customWidth: info.width,
                            customHeight: info.height,
                            format: info.format,
                            codec: info.codec,
                            bitrate: info.bitrate.toString(),
                            frameRate: frameRate,
                        };
                        console.log('Setting video settings:', newSettings);
                        setVideoSettings(prev => ({
                            ...prev,
                            [uniqueFile.name]: newSettings
                        }));
                    } catch (error) {
                        console.error("Failed to get video info:", error);
                        setLogs(prev => [...prev, `Error getting video info: ${error.message}`]);
                    }
                };

                reader.onerror = () => {
                    console.error("Failed to read file");
                    setLogs(prev => [...prev, `Error reading file: ${file.name}`]);
                };

                reader.readAsDataURL(file);
                URL.revokeObjectURL(fileUrl);
            } catch (error) {
                console.error("Failed to process file:", error);
                setLogs(prev => [...prev, `Error processing file: ${error.message}`]);
            }
        }

        setSelectedFiles(updatedFiles);
    }, [selectedFiles, setSelectedFiles]);

    const { getRootProps, getInputProps } = useDropzone({
        accept: { "video/mp4": [] },
        disabled: processing,
        onDrop,
    });

    const generateThumbnail = useCallback((file) => {
        const video = document.createElement("video");
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");

        video.src = URL.createObjectURL(file);
        video.crossOrigin = "anonymous";
        video.currentTime = 1;
        video.muted = true;

        video.onloadeddata = () => {
            video.play();
        };

        video.onseeked = () => {
            canvas.width = video.videoWidth / 4;
            canvas.height = video.videoHeight / 4;
            if (ctx != null) {
                ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            }

            const thumbnailUrl = canvas.toDataURL("image/webp");
            setThumbnails((prev) => ({ ...prev, [file.name]: thumbnailUrl }));
            video.pause();
        };

        video.onerror = (e) => {
            console.error("Error loading video:", e);
        };

        video.currentTime = 1;
    }, []);

    const calculateAspectRatio = (width: number, height: number) => {
        return width / height;
    };

    const calculateVideoSize = (bitrate: number, duration: number): number => {
        // bitrate is in kbps, duration in seconds
        // size = (bitrate * duration) / 8 = size in kilobytes
        // return in megabytes
        return (bitrate * duration) / 8 / 1024;
    };

    const formatSize = (size: number): string => {
        if (size < 1024) {
            return `${size.toFixed(2)} MB`;
        }
        return `${(size / 1024).toFixed(2)} GB`;
    };

    const calculateBitrateScale = (originalWidth: number, originalHeight: number, newWidth: number, newHeight: number): number => {
        const originalPixels = originalWidth * originalHeight;
        const newPixels = newWidth * newHeight;
        return Math.sqrt(newPixels / originalPixels);
    };

    const updateEstimatedSize = (fileName: string) => {
        const info = videoInfo[fileName];
        const settings = videoSettings[fileName];
        
        if (!info) {
            setEstimatedSizes(prev => ({
                ...prev,
                [fileName]: { original: "N/A", estimated: "N/A" }
            }));
            return;
        }

        const originalSize = calculateVideoSize(info.bitrate, info.duration);
        let newBitrate = parseInt(settings?.bitrate || info.bitrate.toString());

        // Adjust bitrate based on resolution change if custom resolution is set
        if (settings?.resolution === "Custom" && settings.customWidth && settings.customHeight) {
            const bitrateScale = calculateBitrateScale(
                info.width,
                info.height,
                settings.customWidth,
                settings.customHeight
            );
            // Only auto-adjust bitrate if user hasn't manually set it
            if (!settings.bitrate || settings.bitrate === info.bitrate.toString()) {
                newBitrate = Math.round(info.bitrate * bitrateScale);
                // Update the bitrate in settings
                setVideoSettings(prev => ({
                    ...prev,
                    [fileName]: {
                        ...prev[fileName],
                        bitrate: newBitrate.toString()
                    }
                }));
            }
        } else if (settings?.resolution && settings.resolution !== "Custom") {
            // Handle standard resolutions
            const match = settings.resolution.match(/(\d+)p/);
            if (match) {
                const targetHeight = parseInt(match[1]);
                const targetWidth = Math.round(targetHeight * (info.width / info.height));
                const bitrateScale = calculateBitrateScale(
                    info.width,
                    info.height,
                    targetWidth,
                    targetHeight
                );
                // Only auto-adjust bitrate if user hasn't manually set it
                if (!settings.bitrate || settings.bitrate === info.bitrate.toString()) {
                    newBitrate = Math.round(info.bitrate * bitrateScale);
                    // Update the bitrate in settings
                    setVideoSettings(prev => ({
                        ...prev,
                        [fileName]: {
                            ...prev[fileName],
                            bitrate: newBitrate.toString()
                        }
                    }));
                }
            }
        }

        const estimatedSize = calculateVideoSize(newBitrate, info.duration);

        setEstimatedSizes(prev => ({
            ...prev,
            [fileName]: {
                original: formatSize(originalSize),
                estimated: formatSize(estimatedSize)
            }
        }));
    };

    // Update estimated sizes when video info is loaded
    useEffect(() => {
        Object.keys(videoInfo).forEach(fileName => {
            updateEstimatedSize(fileName);
        });
    }, [videoInfo]);

    const validateBitrate = (value: string): string => {
        const numValue = parseInt(value);
        if (isNaN(numValue) || numValue < 50) {
            return "50";
        }
        if (numValue > 100000) {
            return "100000";
        }
        return value;
    };

    const discardFile = useCallback((fileToRemove) => {
        setSelectedFiles((prevFiles) => prevFiles.filter((f) => f !== fileToRemove));
        setProgressMap((prev) => {
            const newProgress = { ...prev };
            delete newProgress[fileToRemove.name];
            return newProgress;
        });
        setVideoSettings((prev) => {
            const newSettings = { ...prev };
            delete newSettings[fileToRemove.name];
            return newSettings;
        });
    }, []);

    const handleRescale = async () => {
        if (selectedFiles.length === 0) {
            // Show alert (you might want to add alert functionality)
            return;
        }

        setProcessing(true);
        // Add processing logic here
        // This would involve calling your backend to handle the video rescaling
    };

    const handleCancel = () => {
        setProcessing(false);
        setProgressMap({});
    };

    const preventArrowKeys = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
        }
    };

    const handleSettingsChange = (fileName: string, setting: keyof VideoSettings, value: string | number) => {
        const currentSettings = videoSettings[fileName] || {
            resolution: "Custom",
            customWidth: videoInfo[fileName]?.width || 0,
            customHeight: videoInfo[fileName]?.height || 0,
            format: videoInfo[fileName]?.format || "mp4",
            codec: videoInfo[fileName]?.codec || "h264",
            bitrate: (videoInfo[fileName]?.bitrate || 5000).toString(),
            frameRate: (videoInfo[fileName]?.frameRate || 30).toString()
        };

        if (setting === "resolution") {
            const info = videoInfo[fileName];
            if (!info) return;

            let newWidth = info.width;
            let newHeight = info.height;
            let newBitrate = currentSettings.bitrate; // Keep existing bitrate by default

            if (value === "Custom") {
                // Keep current custom dimensions if they exist
                newWidth = currentSettings.customWidth || info.width;
                newHeight = currentSettings.customHeight || info.height;
            } else {
                // Parse standard resolution
                const match = value.toString().match(/(\d+)p/);
                if (match) {
                    const targetHeight = parseInt(match[1]);
                    const aspectRatio = info.width / info.height;
                    newHeight = targetHeight;
                    newWidth = Math.round(targetHeight * aspectRatio);
                }
            }

            // Only auto-adjust bitrate if it hasn't been manually changed
            const hasManualBitrate = currentSettings.bitrate !== info.bitrate.toString();
            if (!hasManualBitrate) {
                const bitrateScale = calculateBitrateScale(info.width, info.height, newWidth, newHeight);
                newBitrate = Math.round(info.bitrate * bitrateScale).toString();
            }

            setVideoSettings(prev => ({
                ...prev,
                [fileName]: {
                    ...currentSettings,
                    resolution: value.toString(),
                    customWidth: newWidth,
                    customHeight: newHeight,
                    bitrate: newBitrate
                }
            }));

            // Update estimated size after settings change
            setTimeout(() => updateEstimatedSize(fileName), 0);
            return;
        }

        if (setting === "customWidth" || setting === "customHeight") {
            const originalWidth = videoInfo[fileName]?.width || 0;
            const originalHeight = videoInfo[fileName]?.height || 0;
            const originalAspectRatio = calculateAspectRatio(originalWidth, originalHeight);

            let newWidth = currentSettings.customWidth;
            let newHeight = currentSettings.customHeight;

            if (setting === "customWidth") {
                newWidth = parseInt(value.toString()) || 0;
                newHeight = Math.round(newWidth / originalAspectRatio);
            } else {
                newHeight = parseInt(value.toString()) || 0;
                newWidth = Math.round(newHeight * originalAspectRatio);
            }

            // Only auto-adjust bitrate if it hasn't been manually changed
            let newBitrate = currentSettings.bitrate;
            const hasManualBitrate = currentSettings.bitrate !== videoInfo[fileName].bitrate.toString();
            if (!hasManualBitrate) {
                const bitrateScale = calculateBitrateScale(
                    originalWidth,
                    originalHeight,
                    newWidth,
                    newHeight
                );
                newBitrate = Math.round(videoInfo[fileName].bitrate * bitrateScale).toString();
            }

            setVideoSettings(prev => ({
                ...prev,
                [fileName]: {
                    ...currentSettings,
                    customWidth: newWidth,
                    customHeight: newHeight,
                    bitrate: newBitrate
                }
            }));
            
            // Update estimated size after settings change
            setTimeout(() => updateEstimatedSize(fileName), 0);
            return;
        }

        setVideoSettings(prev => ({
            ...prev,
            [fileName]: {
                ...currentSettings,
                [setting]: value.toString()
            }
        }));

        // Update estimated size after settings change
        setTimeout(() => updateEstimatedSize(fileName), 0);
    };

    // Add inside RescalingSection component, before the return statement
    const resetVideoSettings = (fileName: string) => {
        const info = videoInfo[fileName];
        if (!info) return;

        const originalSettings = {
            resolution: getResolutionLabel(info.height, info.width),
            customWidth: info.width,
            customHeight: info.height,
            format: info.format,
            codec: info.codec,
            bitrate: info.bitrate.toString(),
            frameRate: info.frameRate.toString()
        };

        setVideoSettings(prev => ({
            ...prev,
            [fileName]: originalSettings
        }));

        setTimeout(() => updateEstimatedSize(fileName), 0);
    };

    const getBitrateWarning = (height: string | number, bitrate: string | number): string | null => {
        const heightNum = typeof height === 'string' ? parseInt(height) : height;
        const bitrateNum = typeof bitrate === 'string' ? parseInt(bitrate) : bitrate;
        
        const resolutionMap = {
            480: "480p",
            720: "720p",
            1080: "1080p",
            1440: "1440p",
            2160: "2160p"
        };
        
        const closestResolution = Object.entries(resolutionMap)
            .reduce((prev, [res, label]) => {
                return Math.abs(parseInt(res) - heightNum) < Math.abs(parseInt(prev[0]) - heightNum) 
                    ? [res, label] 
                    : prev;
            })[1];

        const minimumBitrate = MINIMUM_BITRATES[closestResolution];
        return bitrateNum < minimumBitrate 
            ? `Warning: Bitrate might be too low for ${closestResolution}. Recommended minimum: ${minimumBitrate}kbps`
            : null;
    };

    return (
        <div className="h-full grid grid-cols-5 gap-4 grid-rows-[auto_1fr_auto] p-4">
            {/* Drop Zone Area */}
            <div className="col-span-5">
                <div
                    {...getRootProps()}
                    className={`text-center cursor-pointer border-2 border-dashed border-gray-500 rounded-lg w-full h-32 flex items-center justify-center 
                    ${processing ? "opacity-50 cursor-not-allowed" : "hover:bg-opacity-50"}`}
                >
                    <input {...getInputProps()} disabled={processing} />
                    <p className="text-lg flex gap-2">
                        📂 Drag & drop videos here, or click to select
                    </p>
                </div>
            </div>

            {/* File List Area */}
            <div className="col-span-5 h-full min-h-0">
                <ScrollArea className="h-full">
                    {selectedFiles.length > 0 ? (
                        <ul className="list-none space-y-2 pr-4">
                            {selectedFiles.map((file) => (
                                <div className="relative" key={file.name}>
                                    {/* Progress Bar - Move it below the content but keep it visible */}
                                    <div className={`absolute top-0 left-0 w-full h-full ${processing ? "z-[1]" : "z-0"}`}>
                                        <ProgressBar
                                            completed={progressMap[file.name] || 0}
                                            bgColor="rgba(255,255,255,0.1)"
                                            baseBgColor="rgba(0,0,0,0)"
                                            borderRadius="5px"
                                            height="90px"
                                            isLabelVisible={false}
                                        />
                                    </div>
                                    <li className={`flex flex-col gap-4 p-3 rounded-lg shadow-md border border-gray-600 relative ${processing ? "z-[2]" : "z-[2]"}`}>
                                        <div className="flex items-center gap-4">
                                            {/* Thumbnail */}
                                            {thumbnails[file.name] && (
                                                <img
                                                    src={thumbnails[file.name]}
                                                    alt="Thumbnail"
                                                    className="w-16 h-16 object-cover rounded-md border border-gray-700"
                                                />
                                            )}

                                            {/* File Info */}
                                            <div className="flex-1 overflow-hidden">
                                                <span className="block font-semibold truncate">{file.name}</span>
                                                <div className="text-sm flex gap-4">
                                                    <span>Original: {(file.size / (1024 * 1024)).toFixed(2)} MB</span>
                                                    {videoInfo[file.name] && (
                                                        <>
                                                            <span>Estimated: {estimatedSizes[file.name]?.estimated || "calculating..."}</span>
                                                            <span className="text-gray-400">
                                                                ({videoInfo[file.name].duration.toFixed(1)}s)
                                                            </span>
                                                        </>
                                                    )}
                                                </div>
                                            </div>

                                            {/* Remove Button */}
                                            <Button
                                                className={`font-bold relative z-[3]`}
                                                onClick={() => discardFile(file)}
                                                variant="destructive"
                                            >
                                                X
                                            </Button>
                                        </div>

                                        {/* Video Settings */}
                                        <div className="grid grid-cols-6 gap-4 relative z-[2]">
                                            {/* Reset Button */}
                                            <div className="col-span-6 flex justify-end">
                                                <TooltipProvider>
                                                    <Tooltip>
                                                        <TooltipTrigger asChild>
                                                            <Button
                                                                variant="ghost"
                                                                size="sm"
                                                                onClick={() => resetVideoSettings(file.name)}
                                                                disabled={processing}
                                                            >
                                                                <RotateCcw className="w-4 h-4 mr-1" />
                                                                Reset to Original
                                                            </Button>
                                                        </TooltipTrigger>
                                                        <TooltipContent>
                                                            <p>Reset all settings to original video values</p>
                                                        </TooltipContent>
                                                    </Tooltip>
                                                </TooltipProvider>
                                            </div>

                                            {/* Resolution */}
                                            <div className="col-span-2">
                                                <Label className="flex items-center gap-1">
                                                    Resolution
                                                    {videoInfo[file.name] && isValueModified(
                                                        videoSettings[file.name]?.resolution || "",
                                                        getResolutionLabel(videoInfo[file.name].height, videoInfo[file.name].width)
                                                    ) && (
                                                        <TooltipProvider>
                                                            <Tooltip>
                                                                <TooltipTrigger>
                                                                    <Info className="w-4 h-4 text-yellow-500" />
                                                                </TooltipTrigger>
                                                                <TooltipContent>
                                                                    <p>Original: {videoInfo[file.name].width}x{videoInfo[file.name].height}</p>
                                                                </TooltipContent>
                                                            </Tooltip>
                                                        </TooltipProvider>
                                                    )}
                                                </Label>
                                                <Select
                                                    value={videoSettings[file.name]?.resolution || "Custom"}
                                                    onValueChange={(value) => handleSettingsChange(file.name, "resolution", value)}
                                                    disabled={processing}
                                                >
                                                    <SelectTrigger className="relative z-[3]">
                                                        <SelectValue placeholder="Select resolution" />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        {VIDEO_RESOLUTIONS.map((res) => (
                                                            <SelectItem key={res.label} value={res.label}>
                                                                {res.label}
                                                            </SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                                {(videoSettings[file.name]?.resolution === "Custom" || 
                                                videoSettings[file.name]?.resolution === "Custom (Custom)") && (
                                                    <div className="grid grid-cols-2 gap-2 mt-2">
                                                        <div>
                                                            <Label className="text-xs">Width</Label>
                                                            <Input
                                                                type="number"
                                                                min="1"
                                                                value={videoSettings[file.name]?.customWidth || videoInfo[file.name]?.width || ""}
                                                                onChange={(e) => {
                                                                    const value = e.target.value;
                                                                    if (value === "" || /^\d+$/.test(value)) {
                                                                        handleSettingsChange(file.name, "customWidth", value);
                                                                    }
                                                                }}
                                                                onKeyDown={preventArrowKeys}
                                                                className="w-full relative z-[3] [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                                                disabled={processing || videoSettings[file.name]?.resolution !== "Custom"}
                                                            />
                                                        </div>
                                                        <div>
                                                            <Label className="text-xs">Height</Label>
                                                            <Input
                                                                type="number"
                                                                min="1"
                                                                value={videoSettings[file.name]?.customHeight || videoInfo[file.name]?.height || ""}
                                                                onChange={(e) => {
                                                                    const value = e.target.value;
                                                                    if (value === "" || /^\d+$/.test(value)) {
                                                                        handleSettingsChange(file.name, "customHeight", value);
                                                                    }
                                                                }}
                                                                onKeyDown={preventArrowKeys}
                                                                className="w-full relative z-[3] [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                                                disabled={processing || videoSettings[file.name]?.resolution !== "Custom"}
                                                            />
                                                        </div>
                                                    </div>
                                                )}
                                            </div>

                                            {/* Format */}
                                            <div>
                                                <Label>Format</Label>
                                                <Select
                                                    value={videoSettings[file.name]?.format || videoInfo[file.name]?.format || "mp4"}
                                                    onValueChange={(value) => handleSettingsChange(file.name, "format", value)}
                                                    disabled={processing}
                                                >
                                                    <SelectTrigger className="relative z-[3]">
                                                        <SelectValue placeholder="Format" />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        {VIDEO_FORMATS.map((format) => (
                                                            <SelectItem key={format} value={format}>
                                                                {format}
                                                            </SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                            </div>

                                            {/* Codec */}
                                            <div>
                                                <Label>Codec</Label>
                                                <Select
                                                    value={videoSettings[file.name]?.codec || videoInfo[file.name]?.codec || "h264"}
                                                    onValueChange={(value) => handleSettingsChange(file.name, "codec", value)}
                                                    disabled={processing}
                                                >
                                                    <SelectTrigger className="relative z-[3]">
                                                        <SelectValue placeholder="Codec" />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        {VIDEO_CODECS.map((codec) => (
                                                            <SelectItem key={codec} value={codec}>
                                                                {codec}
                                                            </SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                            </div>

                                            {/* Bitrate */}
                                            <div>
                                                <Label className="flex items-center gap-1">
                                                    Bitrate (kbps)
                                                    {videoInfo[file.name] && isValueModified(
                                                        videoSettings[file.name]?.bitrate || "",
                                                        videoInfo[file.name].bitrate
                                                    ) && (
                                                        <TooltipProvider>
                                                            <Tooltip>
                                                                <TooltipTrigger>
                                                                    <Info className="w-4 h-4 text-yellow-500" />
                                                                </TooltipTrigger>
                                                                <TooltipContent>
                                                                    <p>Original: {videoInfo[file.name].bitrate}kbps</p>
                                                                </TooltipContent>
                                                            </Tooltip>
                                                        </TooltipProvider>
                                                    )}
                                                </Label>
                                                <Input
                                                    type="number"
                                                    min="1"
                                                    max="100000"
                                                    value={videoSettings[file.name]?.bitrate || videoInfo[file.name]?.bitrate || "5000"}
                                                    onChange={(e) => {
                                                        const value = e.target.value;
                                                        if (value === "" || /^\d+$/.test(value)) {
                                                            handleSettingsChange(file.name, "bitrate", value);
                                                        }
                                                    }}
                                                    onKeyDown={preventArrowKeys}
                                                    onBlur={(e) => {
                                                        const validatedValue = validateBitrate(e.target.value);
                                                        handleSettingsChange(file.name, "bitrate", validatedValue);
                                                    }}
                                                    className={`w-full relative z-[3] [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none ${
                                                        videoInfo[file.name] && 
                                                        getBitrateWarning(
                                                            videoSettings[file.name]?.customHeight?.toString() || videoInfo[file.name].height.toString(),
                                                            (videoSettings[file.name]?.bitrate || videoInfo[file.name].bitrate).toString()
                                                        ) ? 'border-yellow-500' : ''
                                                    }`}
                                                    disabled={processing}
                                                />
                                                {videoInfo[file.name] && (
                                                    <div className="text-xs text-yellow-500 mt-1">
                                                        {getBitrateWarning(
                                                            videoSettings[file.name]?.customHeight?.toString() || videoInfo[file.name].height.toString(),
                                                            (videoSettings[file.name]?.bitrate || videoInfo[file.name].bitrate).toString()
                                                        )}
                                                    </div>
                                                )}
                                            </div>

                                            {/* Frame Rate */}
                                            <div>
                                                <Label className="flex items-center gap-1">
                                                    Frame Rate
                                                    {videoInfo[file.name] && isValueModified(
                                                        videoSettings[file.name]?.frameRate || "",
                                                        videoInfo[file.name].frameRate
                                                    ) && (
                                                        <TooltipProvider>
                                                            <Tooltip>
                                                                <TooltipTrigger>
                                                                    <Info className="w-4 h-4 text-yellow-500" />
                                                                </TooltipTrigger>
                                                                <TooltipContent>
                                                                    <p>Original: {videoInfo[file.name].frameRate}fps</p>
                                                                </TooltipContent>
                                                            </Tooltip>
                                                        </TooltipProvider>
                                                    )}
                                                </Label>
                                                <Select
                                                    value={videoSettings[file.name]?.frameRate || "30"}
                                                    onValueChange={(value) => handleSettingsChange(file.name, "frameRate", value)}
                                                    disabled={processing}
                                                >
                                                    <SelectTrigger className="relative z-[3]">
                                                        <SelectValue placeholder="FPS" />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        {FRAME_RATES.map((fps) => (
                                                            <SelectItem key={fps.value} value={fps.value}>
                                                                {fps.label}
                                                            </SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                        </div>
                                    </li>
                                </div>
                            ))}
                        </ul>
                    ) : (
                        <div>
                            <p className="text-gray-400 text-center">No files selected.</p>
                        </div>
                    )}
                </ScrollArea>
            </div>

            {/* Bottom Controls Area */}
            <div className="col-span-4 pr-4">
                <div className="flex flex-col rounded-lg shadow-lg border">
                    <div className="px-4 py-3 border-b flex items-center justify-between rounded-t-lg">
                        <Label className="font-semibold flex items-center gap-2">
                            🖥 Terminal Logs
                        </Label>
                    </div>

                    <ScrollArea ref={logContainerRef} className="p-4 h-32 text-xs font-mono break-words rounded-b-lg">
                        <pre className="whitespace-pre-wrap overflow-wrap break-words">
                            {logs.join("\n") || "No logs yet..."}
                        </pre>
                    </ScrollArea>
                </div>
            </div>

            {/* Right Side Controls */}
            <div className="col-span-1">
                <div className="flex flex-col gap-2">
                    <Button
                        onClick={handleRescale}
                        disabled={processing || selectedFiles.length === 0}
                        variant="outline"
                        className="w-full"
                    >
                        {processing ? (
                            <>
                                <Loader2 className="animate-spin mr-2" />
                                <span>{elapsedTime}s</span>
                            </>
                        ) : (
                            "Rescale Videos"
                        )}
                    </Button>

                    {processing && (
                        <Button
                            onClick={handleCancel}
                            variant="destructive"
                            className="w-full"
                        >
                            <XCircle className="mr-2" /> Cancel
                        </Button>
                    )}
                </div>
            </div>
        </div>
    );
} 