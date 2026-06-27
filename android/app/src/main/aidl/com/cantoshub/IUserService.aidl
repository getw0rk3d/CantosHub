// IUserService.aidl
package com.cantoshub;

interface IUserService {
    // Destroy method defined by the Shizuku server — must keep this transaction id.
    void destroy() = 16777114;

    void exit() = 1;

    // Run a shell command (argv) at Shizuku's privilege level; returns combined output.
    String exec(in List<String> command) = 2;
}
