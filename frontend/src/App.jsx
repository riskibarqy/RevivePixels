import React, { useState, useEffect, useCallback, useRef } from "react";
import { useDropzone } from "react-dropzone";
import { ProcessVideosFromUpload, CancelProcessing } from "../wailsjs/go/main/App";
import { EventsOn, EventsOff } from "../wailsjs/runtime";
import { color, motion } from "framer-motion";
import { Loader2, Upload, XCircle } from "lucide-react";
import Button from "./components/ui/button";

function App() {
    const [selectedFiles, setSelectedFiles] = useState([]);
    const [status, setStatus] = useState({});
    const [selectedModel, setSelectedModel] = useState("realesrgan-x4plus");
    const [logs, setLogs] = useState([]);
    const [processing, setProcessing] = useState(false);
    const [elapsedTime, setElapsedTime] = useState(0);
    const logContainerRef = useRef(null);
    const startTimeRef = useRef(null);
    const [thumbnails, setThumbnails] = useState({}); // Store thumbnails per file

    let timer = useRef(null);

    useEffect(() => {
        const handler = (log) => setLogs((prevLogs) => [...prevLogs, log]);
        EventsOn("stderr_log", handler);
        return () => EventsOff("stderr_log", handler);
    }, []);

    useEffect(() => {
        if (logContainerRef.current) {
            logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
        }
    }, [logs]);

    useEffect(() => {
        if (processing) {
            startTimeRef.current = Date.now();
            timer.current = setInterval(() => {
                setElapsedTime(((Date.now() - startTimeRef.current) / 1000).toFixed(1));
            }, 100);
        } else {
            clearInterval(timer.current);
        }
    }, [processing]);

    const onDrop = useCallback((acceptedFiles) => {
        setSelectedFiles(acceptedFiles);
        setStatus({});

        acceptedFiles.forEach((file) => {
            generateThumbnail(file);
        });
    }, []);

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
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

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


    const { getRootProps, getInputProps } = useDropzone({
        accept: { "video/*": [] },
        onDrop,
    });

    const handleUpscale = async () => {
        if (selectedFiles.length === 0) {
            alert("Please select at least one file.");
            return;
        }
        setProcessing(true);
        setStatus(Object.fromEntries(selectedFiles.map((file) => [file.name, "Processing..."])));
        try {
            const fileDataPromises = selectedFiles.map((file) =>
                new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.readAsDataURL(file);
                    reader.onloadend = () => resolve(reader.result.split(",")[1]);
                    reader.onerror = reject;
                })
            );
            const filesBase64 = await Promise.all(fileDataPromises);
            const filenames = selectedFiles.map((file) => file.name);
            const result = await ProcessVideosFromUpload(filesBase64, filenames, selectedModel);
            setStatus(result);
            setLogs((prevLogs) => [...prevLogs, `Processing result: ${JSON.stringify(result)}`]);
        } catch (error) {
            setLogs((prevLogs) => [...prevLogs, error.name === "AbortError" ? "Processing was canceled." : `Error: ${error.message}`]);
        }
        setProcessing(false);
    };

    const discardFile = (file) => {
        setSelectedFiles(selectedFiles.filter(f => f.name !== file.name)); // Remove the discarded file from the list
    };

    const handleCancel = () => {
        CancelProcessing();
        setProcessing(false);
        setStatus("pending");
        setElapsedTime(0);
        setLogs((prevLogs) => [...prevLogs, "Process canceled."]);
    };

    return (

        <div className="grid grid-cols-4 md:grid-cols-5 grid-rows-5 h-screen w-screen overflow-hidden">
            {/* Drop Files */}
            <div className="col-span-4 flex flex-col items-center justify-center p-3">
                <div {...getRootProps()}
                    className="p-6 text-center cursor-pointer hover:bg-opacity-50 border-2 border-dashed border-gray-500 rounded-lg w-full h-48 flex items-center justify-center">
                    <input {...getInputProps()} />
                    <p className="text-lg flex items-center justify-center gap-2">
                        📂 Drag & drop videos here, or click to select
                    </p>
                </div>
            </div>

            {/* Terminal Logs */}
            <div ref={logContainerRef} className="col-span-4 row-start-5 min-h-full bg-black rounded-md overflow-auto text-green-400 mb-1 ml-1 mr-1 p-3">
                <h2 className="text-lg font-semibold text-white">Terminal Logs:</h2>
                <pre className="text-sm whitespace-pre-wrap">{logs.join("\n")}</pre>
            </div>

            {/* Upscale Model Selector */}
            <div className="row-span-2 col-start-5 row-start-1 flex flex-col p-3">
                <label className="text-lg">Upscale Model:</label>
                <select
                    value={selectedModel}
                    onChange={(e) => setSelectedModel(e.target.value)}
                    className="mt-2 bg-gray-700 text-white p-2 rounded-lg"
                >
                    <option value="realesrgan-x4plus">realesrgan-x4plus</option>
                    <option value="realesrnet-x4plus">realesrnet-x4plus</option>
                    <option value="realesr-animevideov3">realesr-animevideov3</option>
                    <option value="realesrgan-x4plus-anime">realesrgan-x4plus-anime</option>
                </select>
            </div>

            {/* File List */}
            <div className="col-span-4 row-span-3 col-start-1 row-start-2 overflow-y-auto h-full p-3 bg-gray-800 rounded-md">
                {selectedFiles.length > 0 ? (
                    <ul className="list-none text-white">
                        {selectedFiles.map((file) => (
                            <li key={file.name} className="flex items-center gap-3 p-2 bg-gray-700 rounded-md mb-2">
                                {/* Thumbnail */}
                                {thumbnails[file.name] && (
                                    <img src={thumbnails[file.name]} alt="Thumbnail" className="w-16 h-16 object-cover rounded-md" />
                                )}

                                {/* File Info */}
                                <div className="flex-1 overflow-hidden">
                                    <span className="text-white block truncate">{file.name}</span>
                                    <span className="text-sm text-gray-400">{(file.size / (1024 * 1024)).toFixed(2) + " MB "}</span>
                                </div>

                                {/* Remove Button */}
                                <button
                                    className="text-red-600 hover:text-red-800"
                                    onClick={() => discardFile(file)}
                                >
                                    ❌
                                </button>
                            </li>
                        ))}
                    </ul>
                ) : (
                    <p className="text-gray-400 text-center">No files selected.</p>
                )}
            </div>

            {/* Buttons */}
            <div className="col-start-5 row-start-5 flex flex-col place-self-stretch">
                <Button onClick={handleUpscale} disabled={processing} className="w-full p-4 rounded-none">
                    {processing ? <Loader2 className="animate-spin" /> : "Upscale Videos"} {processing && `(${elapsedTime}s)`}
                </Button>
                {processing && (
                    <Button onClick={handleCancel} variant="destructive" className="w-full flex items-center justify-center gap-2 rounded-none">
                        <XCircle size={20} /> Cancel
                    </Button>
                )}
            </div>
        </div>

    );
}

export default App;
