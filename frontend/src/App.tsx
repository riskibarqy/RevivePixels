import * as React from "react";
import { useState, useRef, useEffect } from "react";
import { EventsOn, EventsOff } from "../wailsjs/runtime/runtime";
import { ThemeProvider } from "@/components/theme-provider"
import { ModeToggle } from "@/components/mode-toggle"
import useAlertDialog from "@/hooks/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { UpscalingSection } from "@/components/UpscalingSection";
import { RescalingSection } from "@/components/RescalingSection";

function App() {
    const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
    const [rescalingFiles, setRescalingFiles] = useState<File[]>([]);
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

    useEffect(() => {
        if (logContainerRef.current) {
            const viewport = logContainerRef.current.querySelector('[data-radix-scroll-area-viewport]');
            if (viewport) {
                viewport.scrollTop = viewport.scrollHeight;
            }
        }
    }, [logs]);

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

    return (
        <ThemeProvider defaultTheme="dark" storageKey="vite-ui-theme">
            <div className="h-screen flex flex-col">
                <div className="border-b">
                    <div className="container mx-auto px-4 py-2">
                        <h1 className="text-xl font-bold">RevivePixels</h1>
                    </div>
                </div>

                <Tabs defaultValue="upscaling" className="flex-1">
                    <div className="container mx-auto px-4 py-2">
                        <TabsList className="grid w-full grid-cols-2">
                            <TabsTrigger value="upscaling">Upscaling</TabsTrigger>
                            <TabsTrigger value="rescaling">Rescaling</TabsTrigger>
                        </TabsList>
                    </div>

                    <div className="h-[calc(100vh-120px)]">
                        <TabsContent value="upscaling" className="h-full m-0 data-[state=active]:block">
                            <UpscalingSection
                                selectedFiles={selectedFiles}
                                setSelectedFiles={setSelectedFiles}
                                status={status}
                                setStatus={setStatus}
                                logs={logs}
                                setLogs={setLogs}
                                processing={processing}
                                setProcessing={setProcessing}
                                elapsedTime={elapsedTime}
                                setElapsedTime={setElapsedTime}
                                progressMap={progressMap}
                                setProgressMap={setProgressMap}
                                logContainerRef={logContainerRef}
                                thumbnails={thumbnails}
                                setThumbnails={setThumbnails}
                                fileSettings={fileSettings}
                                setFileSettings={setFileSettings}
                                shutdownAfterDone={shutdownAfterDone}
                                setShutdownAfterDone={setShutdownAfterDone}
                                showAlert={showAlert}
                            />
                        </TabsContent>

                        <TabsContent value="rescaling" className="h-full m-0 data-[state=active]:block">
                            <RescalingSection
                                selectedFiles={rescalingFiles}
                                setSelectedFiles={setRescalingFiles}
                                logs={logs}
                                setLogs={setLogs}
                            />
                        </TabsContent>
                    </div>
                </Tabs>

                {/* Floating Mode Toggle */}
                <div className="fixed bottom-4 right-4">
                    <ModeToggle />
                </div>

                {AlertComponent}
            </div>
        </ThemeProvider>
    );
}

export default App;
