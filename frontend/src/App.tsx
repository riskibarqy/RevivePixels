import * as React from "react";
import { useState, useRef, useEffect, useCallback } from "react";
import { useDropzone } from "react-dropzone";
import { ProcessVideosFromUpload, CancelProcessing, OpenOutputFolder, ShutdownComputer } from "../wailsjs/go/main/App";
import { EventsOn, EventsOff } from "../wailsjs/runtime/runtime";
import { color, motion } from "framer-motion";
import { Loader2, Upload, XCircle } from "lucide-react";
import ProgressBar from "@ramonak/react-progress-bar";
import { datatransfers } from "../wailsjs/go/models";
import { Button } from "@/components/ui/button";
import {
    Select,
    SelectTrigger,
    SelectValue,
    SelectContent,
    SelectItem
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { ThemeProvider } from "@/components/theme-provider"
import { ModeToggle } from "@/components/mode-toggle"
import useAlertDialog from "@/hooks/alert-dialog";



const UPSCALE_MODELS = [
    { name: "realesrgan-x4plus", scales: [4] },
    { name: "realesrnet-x4plus", scales: [4] },
    { name: "realesrgan-x4plus-anime", scales: [4] },
    { name: "realesr-animevideov3", scales: [2, 3, 4] },
];

function App() {
    const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
    const [status, setStatus] = useState({});
    const [logs, setLogs] = useState<string[]>([]);
    const [processing, setProcessing] = useState(false);
    const [elapsedTime, setElapsedTime] = useState(0);
    const [progressMap, setProgressMap] = useState({});
    const logContainerRef = useRef<HTMLDivElement | null>(null);
    const startTimeRef = useRef<number | null>(null);
    const [thumbnails, setThumbnails] = useState({});
    const [fileSettings, setFileSettings] = useState({});
    const timer: React.MutableRefObject<NodeJS.Timeout | null> = useRef(null);
    const [shutdownAfterDone, setShutdownAfterDone] = useState(false);
    const { showAlert, AlertComponent } = useAlertDialog();

    useEffect(() => {
        if (processing) {
            timer.current = setInterval(() => {
                setElapsedTime((prev) => parseFloat((prev + 0.1).toFixed(1)));
            }, 100);
        } else {
            if (timer.current !== null) {
                clearInterval(timer.current);
            }
        }
    }, [processing]);

    // capture logs 
    useEffect(() => {
        const handler = (log: string) => {
            const match = log.match(/Loading-(\d+)\s*-\s*(.+)/);
            if (match) {
                const percentage = parseInt(match[1], 10);
                const fileName = match[2].trim();
                setProgressMap((prev) => ({
                    ...prev,
                    [fileName]: percentage
                }));
                return;
            }

            setLogs((prevLogs) => [...prevLogs, log]);
        };

        EventsOn("stderr_log", handler);
        return () => EventsOff("stderr_log", handler as unknown as string);
    }, []);

    // keep logs tracked
    useEffect(() => {
        if (logContainerRef.current) {
            logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
        }
    }, [logs]);

    // capture time 
    useEffect(() => {
        if (processing) {
            startTimeRef.current = Date.now();
            timer.current = setInterval(() => {
                setElapsedTime(
                    parseFloat(((Date.now() - startTimeRef.current!) / 1000).toFixed(1))
                );
            }, 100);
        } else {
            if (timer.current !== null) {
                clearInterval(timer.current);
            }
        }
    }, [processing]);


    // onDrop events, callback for file drag and drop
    const onDrop = useCallback((acceptedFiles) => {
        setSelectedFiles(acceptedFiles);
        setStatus({});
        setProgressMap({});

        acceptedFiles.forEach((file) => {
            generateThumbnail(file);
            setFileSettings((prev) => ({
                ...prev,
                [file.name]: prev[file.name] || { model: "realesrgan-x4plus", scale: 4 },
            }));
        });
    }, []);

    // reactDropZone
    const { getRootProps, getInputProps } = useDropzone({
        accept: { "video/*": [] },
        disabled: processing,
        onDrop,
    });

    // generate video thumbnail
    const generateThumbnail = (file) => {
        const video = document.createElement("video");
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");

        video.src = URL.createObjectURL(file);
        video.crossOrigin = "anonymous";
        video.currentTime = 1; // Capture a frame at 1s
        video.muted = true

        video.onloadeddata = () => {
            video.play();
        };

        video.onseeked = () => {
            canvas.width = video.videoWidth / 4; // Resize for preview
            canvas.height = video.videoHeight / 4;
            if (ctx != null) {
                {
                    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                }
            }

            // Convert canvas to data URL (thumbnail)
            const thumbnailUrl = canvas.toDataURL("image/webp");
            setThumbnails((prev) => ({ ...prev, [file.name]: thumbnailUrl }));

            // Cleanup
            video.pause();
            // URL.revokeObjectURL(video.src);
        };

        video.onerror = (e) => {
            // console.error("Error loading video:", e);
        };

        // Seek to trigger onseeked event
        video.currentTime = 1;
    };

    // upscale video
    const handleUpscale = async () => {
        setProgressMap({})
        if (selectedFiles.length === 0) {
            showAlert("Invalid file input", "Please select at least one file")
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
                    }
                    reader.onerror = () => reject(new Error("FileReader encountered an error"));
                })
            );

            const filesBase64 = await Promise.all(fileDataPromises);
            const inputFiles: datatransfers.InputFileRequest[] = selectedFiles.map((file, index) => ({
                FileCode: "", // Assign a value if required
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
                setLogs((prevLogs) => [...prevLogs, "latestShutdown : " + latestShutdown]);
                if (latestShutdown) {
                    setLogs((prevLogs) => [...prevLogs, "shutting down computer .."]);
                    ShutdownComputer();
                }
                return latestShutdown;
            });
        }, 100);
    };

    // clear video
    const discardFile = (file) => {
        setSelectedFiles(selectedFiles.filter(f => f.name !== file.name)); // Remove the discarded file from the list
        setProgressMap((prev) => {
            const newProgress = { ...prev };
            delete newProgress[file.name]; // Remove progress entry for this file
            return newProgress;
        });
    };

    // cancel process
    const handleCancel = () => {
        CancelProcessing();
        setProcessing(false);
        setStatus("pending");
        setElapsedTime(0);
        setProgressMap({});
    };

    // handle model change
    const handleModelChange = (fileName, model) => {
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
    };

    // handle scale change
    const handleScaleChange = (fileName, scale) => {
        setFileSettings((prev) => ({
            ...prev,
            [fileName]: {
                ...prev[fileName],
                scale,
            },
        }));
    };

    // handle open output folder
    const handleOpenOutputFolder = () => {
        OpenOutputFolder()
    }

    // handle clear list video
    const handleClearList = () => {
        setSelectedFiles([])
    }

    // toogle shutdown input
    const toggleShutdownAfterDone = () => {
        setShutdownAfterDone(prevState => !prevState);
    };

    return (
        <ThemeProvider defaultTheme="dark" storageKey="vite-ui-theme">
            {AlertComponent}
            <div className="grid grid-cols-5 grid-rows-5 gap-2 h-screen w-screen overflow-hidden">
                <div className="col-span-5 p-2">
                    <div
                        {...getRootProps()}
                        className={`text-center cursor-pointer border-2 border-dashed border-gray-500 rounded-lg w-full h-36 flex items-center justify-center 
        ${processing ? "opacity-50 cursor-not-allowed" : "hover:bg-opacity-50"}`}
                    >
                        <input {...getInputProps()} disabled={processing} />
                        <p className="text-lg flex gap-2">
                            📂 Drag & drop videos here, or click to select
                        </p>
                    </div>
                </div>

                <div className="col-span-5 row-span-3 row-start-2">
                    {/* File List */}
                    <div className="col-span-4 row-span-3 col-start-1 row-start-2 overflow-y-auto h-full p-3 rounded-md">
                        {selectedFiles.length > 0 ? (
                            <ul className="list-none">
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
                                        <li className="flex items-center gap-4 p-3 rounded-lg shadow-md mb-2 border border-gray-600">
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
                                                <span className="text-sm">{(file.size / (1024 * 1024)).toFixed(2)} MB</span>
                                            </div>

                                            {/* Model & Scale Dropdowns */}
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
                                                    onValueChange={(value) => handleScaleChange(file.name, Number(value))}
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

                                            {/* Remove Button */}
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
                    </div>
                </div>
                <div className="col-span-4 row-start-5 flex flex-col rounded-lg shadow-lg border">
                    <div className="px-4 py-3 border-b flex items-center justify-between rounded-t-lg">
                        <Label className="font-semibold flex items-center gap-2">
                            🖥 Terminal Logs
                        </Label>

                        <TooltipProvider>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <div className="flex items-center gap-2">
                                        <Checkbox checked={shutdownAfterDone} onCheckedChange={toggleShutdownAfterDone} />
                                        <span className="text-sm">Auto Shutdown</span>
                                    </div>
                                </TooltipTrigger>
                                <TooltipContent>
                                    {shutdownAfterDone ? "Shutdown enabled" : "Enable shutdown after process"}
                                </TooltipContent>
                            </Tooltip>
                        </TooltipProvider>
                    </div>

                    <div
                        ref={logContainerRef}
                        className="p-4 text-xs font-mono overflow-auto max-h-64 custom-scroll break-words rounded-b-lg"
                    >
                        <pre className="whitespace-pre-wrap overflow-wrap break-words">
                            {logs.join("\n") || "No logs yet..."}
                        </pre>
                    </div>
                </div>

                {/* Button Section */}
                <div className="col-start-5 row-start-5 flex flex-col gap-3 mr-2">
                    {/* Utility Buttons */}
                    <div className="flex items-center gap-2">
                        <TooltipProvider>
                            {/* Open Output Folder */}
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button onClick={handleOpenOutputFolder} variant="outline" className="flex items-center justify-center w-full">
                                        📂
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent>Open output folder</TooltipContent>
                            </Tooltip>

                            {/* Clear List */}
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button onClick={handleClearList} variant="outline" className="flex items-center justify-center w-full" disabled={processing}>
                                        🗑
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent>Clear List</TooltipContent>
                            </Tooltip>

                            <ModeToggle />
                        </TooltipProvider>
                    </div>

                    {/* Upscale Button */}
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

                    {/* Cancel Button (Only Visible if Processing) */}
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
        </ThemeProvider>
    );
}

export default App;
