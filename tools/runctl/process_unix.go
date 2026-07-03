//go:build !windows

package main

import (
	"errors"
	"os"
	"os/exec"
	"syscall"
)

func configureDetachedProcess(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
}

func processAlive(pid int) bool {
	if pid <= 0 {
		return false
	}
	err := syscall.Kill(pid, 0)
	return err == nil || errors.Is(err, syscall.EPERM)
}

func signalProcessGroup(pid int, signal os.Signal) error {
	sysSignal, ok := signal.(syscall.Signal)
	if !ok {
		return nil
	}
	if err := syscall.Kill(-pid, sysSignal); err != nil {
		return syscall.Kill(pid, sysSignal)
	}
	return nil
}

func terminateSignal() os.Signal {
	return syscall.SIGTERM
}

func killSignal() os.Signal {
	return syscall.SIGKILL
}
