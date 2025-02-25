import { useState } from "react";
import {
    AlertDialog,
    AlertDialogTrigger,
    AlertDialogContent,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogCancel,
    AlertDialogAction
} from "@/components/ui/alert-dialog";

function useAlertDialog() {
    const [dialog, setDialog] = useState({
        isOpen: false,
        title: "",
        description: "",
        onConfirm: () => {},
    });

    const showAlert = (title: string, description: string, onConfirm?: () => void) => {
        setDialog({
            isOpen: true,
            title,
            description,
            onConfirm: onConfirm || (() => setDialog((prev) => ({ ...prev, isOpen: false }))),
        });
    };

    const AlertComponent = (
        <AlertDialog open={dialog.isOpen} onOpenChange={(open) => setDialog((prev) => ({ ...prev, isOpen: open }))}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>{dialog.title}</AlertDialogTitle>
                    <AlertDialogDescription>{dialog.description}</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={dialog.onConfirm}>OK</AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );

    return { showAlert, AlertComponent };
}

export default useAlertDialog;
