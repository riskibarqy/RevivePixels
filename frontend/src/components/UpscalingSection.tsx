import * as React from "react";
import { useState, useRef, useEffect, useCallback } from "react";
import { useDropzone } from "react-dropzone";
import { ProcessVideosFromUpload, CancelProcessing, OpenOutputFolder, ShutdownComputer } from "../../wailsjs/go/main/App";
import { Loader2, XCircle } from "lucide-react";
import ProgressBar from "@ramonak/react-progress-bar";
import { datatransfers } from "../../wailsjs/go/models";
import { Button } from "@/components/ui/button";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";

interface UpscalingSectionProps {
    selectedFiles: File[];
    setSelectedFiles: React.Dispatch<React.SetStateAction<File[]>>;
    status: any;
    setStatus: React.Dispatch<React.SetStateAction<any>>;
    logs: string[];
    setLogs: React.Dispatch<React.SetStateAction<string[]>>;
    processing: boolean;
    setProcessing: React.Dispatch<React.SetStateAction<boolean>>;
    elapsedTime: number;
    setElapsedTime: React.Dispatch<React.SetStateAction<number>>;
    progressMap: any;
    setProgressMap: React.Dispatch<React.SetStateAction<any>>;
    logContainerRef: React.RefObject<HTMLDivElement>;
    thumbnails: any;
    setThumbnails: React.Dispatch<React.SetStateAction<any>>;
    fileSettings: any;
    setFileSettings: React.Dispatch<React.SetStateAction<any>>;
    shutdownAfterDone: boolean;
    setShutdownAfterDone: React.Dispatch<React.SetStateAction<boolean>>;
    showAlert: (title: string, message: string) => void;
}

const UPSCALE_MODELS = [
    { name: "realesrgan-x4plus", scales: [4] },
    { name: "realesrnet-x4plus", scales: [4] },
    { name: "realesrgan-x4plus-anime", scales: [4] },
    { name: "realesr-animevideov3", scales: [2, 3, 4] },
];

export function UpscalingSection({
    selectedFiles,
    setSelectedFiles,
    status,
    setStatus,
    logs,
    setLogs,
    processing,
    setProcessing,
    elapsedTime,
    setElapsedTime,
    progressMap,
    setProgressMap,
    logContainerRef,
    thumbnails,
    setThumbnails,
    fileSettings,
    setFileSettings,
    shutdownAfterDone,
    setShutdownAfterDone,
    showAlert
}: UpscalingSectionProps) {
    const onDrop = useCallback((acceptedFiles) => {
        setStatus({});
        setProgressMap({});

        const updatedFiles = [...selectedFiles];

        acceptedFiles.forEach((file) => {
            const existingCount = updatedFiles.filter(f => f.name.startsWith(file.name.replace(/\.\w+$/, ''))).length;
            const fileExtension = file.name.substring(file.name.lastIndexOf('.'));
            const fileNameWithoutExt = file.name.replace(/\.\w+$/, '');

            const uniqueName = existingCount > 0
                ? `${fileNameWithoutExt}-(${existingCount})${fileExtension}`
                : file.name;

            const uniqueFile = new File([file], uniqueName, { type: file.type });
            updatedFiles.push(uniqueFile);
            generateThumbnail(uniqueFile);

            setFileSettings((prev) => ({
                ...prev,
                [uniqueFile.name]: prev[file.name] || { model: "realesrgan-x4plus", scale: 4 },
            }));
        });

        setSelectedFiles(updatedFiles);
    }, [selectedFiles, setSelectedFiles, setStatus, setProgressMap, setFileSettings]);

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
            // console.error("Error loading video:", e);
        };

        video.currentTime = 1;
    }, [setThumbnails]);

    const handleUpscale = async () => {
        if (selectedFiles.length === 0) {
            showAlert("Invalid file input", "Please select at least one file");
            return;
        }

        setProcessing(true);
        setStatus(Object.fromEntries(selectedFiles.map((file) => [file.name, "Processing..."])));

        try {
            const fileDataPromises = selectedFiles.map((file) =>
                new Promise<string>((resolve, reject) => {
                    const reader = new FileReader();
                    reader.readAsDataURL(file);
                    reader.onloadend = () => {
                        if (reader.result) {
                            resolve(reader.result.toString().split(",")[1]);
                        } else {
                            reject(new Error("Failed to read file as DataURL"));
                        }
                    };
                    reader.onerror = () => reject(new Error("FileReader encountered an error"));
                })
            );

            const filesBase64 = await Promise.all(fileDataPromises);
            const inputFiles: datatransfers.InputFileRequest[] = selectedFiles.map((file, index) => ({
                FileCode: "",
                FileBase64: filesBase64[index],
                FileName: file.name,
                Model: fileSettings[file.name]?.model,
                Scale: fileSettings[file.name]?.scale,
            }));

            const result = await ProcessVideosFromUpload(inputFiles);
            setStatus(result);

            setTimeout(() => {
                setProgressMap({});
            }, 500);

        } catch (error) {
            setLogs((prevLogs) => [...prevLogs, error.name === "AbortError" ? "Processing was canceled." : `Error: ${error.message}`]);
        }

        setProcessing(false);

        setTimeout(() => {
            setShutdownAfterDone((latestShutdown) => {
                if (latestShutdown) {
                    setLogs((prevLogs) => [...prevLogs, "shutting down computer .."]);
                    ShutdownComputer();
                }
                return latestShutdown;
            });
        }, 100);
    };

    const discardFile = useCallback((fileToRemove) => {
        setSelectedFiles((prevFiles) => prevFiles.filter((f) => f !== fileToRemove));
        setProgressMap((prev) => {
            const newProgress = { ...prev };
            delete newProgress[fileToRemove.name];
            return newProgress;
        });
    }, [setSelectedFiles, setProgressMap]);

    const handleCancel = useCallback(() => {
        CancelProcessing();
        setProcessing(false);
        setStatus("pending");
        setElapsedTime(0);
        setProgressMap({});
    }, [setProcessing, setStatus, setElapsedTime, setProgressMap]);

    const handleModelChange = useCallback((fileName, model) => {
        setFileSettings((prev) => {
            const newScale = UPSCALE_MODELS.find((m) => m.name === model)?.scales[0] || 4;
            return {
                ...prev,
                [fileName]: {
                    ...prev[fileName],
                    model,
                    scale: newScale,
                },
            };
        });
    }, [setFileSettings]);

    const handleScaleChange = useCallback((fileName, scale) => {
        setFileSettings((prev) => ({
            ...prev,
            [fileName]: {
                ...prev[fileName],
                scale: parseInt(scale),
            },
        }));
    }, [setFileSettings]);

    const handleOpenOutputFolder = useCallback(() => {
        OpenOutputFolder();
    }, []);

    const handleClearList = useCallback(() => {
        setSelectedFiles([]);
        setFileSettings({});
    }, [setSelectedFiles, setFileSettings]);

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
                                <div className="relative" key={file.name} >
                                    {/* Progress Bar - Positioned on top of the list */}
                                    <div className={`absolute top-0 left-0 w-full h-full ${processing ? "z-10 cursor-not-allowed" : "z-0"}`}>
                                        <ProgressBar
                                            completed={progressMap[file.name] || 0}
                                            bgColor="rgba(255,255,255,0.1)"
                                            baseBgColor="rgba(0,0,0,0)"
                                            borderRadius="5px"
                                            height="90px"
                                            isLabelVisible={false}
                                        />
                                    </div>
                                    <li className="flex items-center gap-4 p-3 rounded-lg shadow-md border border-gray-600">
                                        {/* Keep existing file item content */}
                                        {thumbnails[file.name] && (
                                            <img
                                                src={thumbnails[file.name]}
                                                alt="Thumbnail"
                                                className="w-16 h-16 object-cover rounded-md border border-gray-700"
                                            />
                                        )}

                                        <div className="flex-1 overflow-hidden">
                                            <span className="block font-semibold truncate">{file.name}</span>
                                            <span className="text-sm">{(file.size / (1024 * 1024)).toFixed(2)} MB</span>
                                        </div>

                                        <div className={`flex items-center gap-2 ${processing ? "z-0" : "z-10"}`}>
                                            <TooltipProvider>
                                                <Tooltip>
                                                    <TooltipTrigger asChild>
                                                        <Select
                                                            value={fileSettings[file.name]?.model || "realesrgan-x4plus"}
                                                            onValueChange={(value) => handleModelChange(file.name, value)}
                                                        >
                                                            <SelectTrigger className="px-2 py-1 rounded-md border">
                                                                <SelectValue placeholder="Select a model" />
                                                            </SelectTrigger>
                                                            <SelectContent>
                                                                {UPSCALE_MODELS.map((model) => (
                                                                    <SelectItem key={model.name} value={model.name}>
                                                                        {model.name}
                                                                    </SelectItem>
                                                                ))}
                                                            </SelectContent>
                                                        </Select>
                                                    </TooltipTrigger>
                                                    <TooltipContent>
                                                        {fileSettings[file.name]?.model || "realesrgan-x4plus"}
                                                    </TooltipContent>
                                                </Tooltip>
                                            </TooltipProvider>

                                            <Select
                                                value={String(fileSettings[file.name]?.scale || 4)}
                                                onValueChange={(value) => handleScaleChange(file.name, value)}
                                            >
                                                <SelectTrigger className="px-2 py-1 rounded-md border">
                                                    <SelectValue placeholder="Select a scale" />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    {UPSCALE_MODELS.find((m) => m.name === fileSettings[file.name]?.model)?.scales.map((scale) => (
                                                        <SelectItem key={scale} value={String(scale)}>
                                                            {`x${scale}`}
                                                        </SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        </div>

                                        <Button
                                            className={`font-bold ${processing ? "z-0" : "z-10"}`}
                                            onClick={() => discardFile(file)}
                                            variant="destructive"
                                        >
                                            X
                                        </Button>
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

                        <TooltipProvider>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <div className="flex items-center gap-2">
                                        <Checkbox checked={shutdownAfterDone} onCheckedChange={() => setShutdownAfterDone(!shutdownAfterDone)} />
                                        <span className="text-sm">Auto Shutdown</span>
                                    </div>
                                </TooltipTrigger>
                                <TooltipContent>
                                    {shutdownAfterDone ? "Shutdown enabled" : "Enable shutdown after process"}
                                </TooltipContent>
                            </Tooltip>
                        </TooltipProvider>
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
                <div className="flex flex-col gap-3 px-2">
                    <div className="flex items-center gap-2">
                        <TooltipProvider>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button onClick={handleOpenOutputFolder} variant="outline" className="flex items-center justify-center w-full">
                                        📂
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent>Open output folder</TooltipContent>
                            </Tooltip>

                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button onClick={handleClearList} variant="outline" className="flex items-center justify-center w-full" disabled={processing}>
                                        🗑
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent>Clear List</TooltipContent>
                            </Tooltip>
                        </TooltipProvider>
                    </div>

                    <Button
                        onClick={handleUpscale}
                        disabled={processing}
                        variant="outline"
                    >
                        {processing ? (
                            <>
                                <Loader2 className="animate-spin" />
                                <span>{elapsedTime}s</span>
                            </>
                        ) : (
                            "Upscale Videos"
                        )}
                    </Button>

                    {processing && (
                        <Button
                            onClick={handleCancel}
                            variant="destructive"
                            className="h-10 flex items-center justify-center gap-2 rounded-md shadow-md"
                        >
                            <XCircle /> Cancel Process
                        </Button>
                    )}
                </div>
            </div>
        </div>
    );
} 