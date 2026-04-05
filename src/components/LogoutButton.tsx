"use client";

import { signOut } from "next-auth/react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { LogOut } from "lucide-react";

export function LogoutButton() {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <button className="flex items-center gap-2 text-sm text-on-surface-variant hover:text-white transition-colors">
          <LogOut className="w-4 h-4" />
          <span>Logout</span>
        </button>
      </AlertDialogTrigger>
      <AlertDialogContent className="bg-surface-container-low border-white/5 text-white">
        <AlertDialogHeader>
          <AlertDialogTitle>Are you sure you want to logout?</AlertDialogTitle>
          <AlertDialogDescription className="text-on-surface-variant">
            You will need to sign in again
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className="bg-transparent border-white/10 text-white hover:bg-white/5">
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={() => signOut({ callbackUrl: "/" })}
            className="bg-primary text-on-primary hover:bg-primary/90"
          >
            Logout
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
