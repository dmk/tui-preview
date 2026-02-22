const std = @import("std");
const TerminalArtifact = enum { ghostty, lib };

pub fn build(b: *std.Build) void {
    const target = b.standardTargetOptions(.{
        .default_target = .{
            .cpu_arch = .wasm32,
            .os_tag = .freestanding,
        },
    });
    const optimize = b.standardOptimizeOption(.{
        .preferred_optimize_mode = .ReleaseFast,
    });

    const terminal_options = b.addOptions();
    terminal_options.addOption(TerminalArtifact, "artifact", .lib);
    terminal_options.addOption(bool, "c_abi", false);
    terminal_options.addOption(bool, "oniguruma", false);
    terminal_options.addOption(bool, "simd", false);
    terminal_options.addOption(bool, "slow_runtime_safety", false);
    terminal_options.addOption(bool, "kitty_graphics", false);
    terminal_options.addOption(bool, "tmux_control_mode", false);

    const module = b.createModule(.{
        .root_source_file = b.path("wrapper.zig"),
        .target = target,
        .optimize = optimize,
    });
    module.addOptions("terminal_options", terminal_options);
    module.addImport(
        "ghostty_vt",
        ghosttyVtModule(b, target, optimize, terminal_options),
    );

    const exe = b.addExecutable(.{
        .name = "ghostty-vt",
        .root_module = module,
    });
    exe.rdynamic = true;
    exe.entry = .disabled;

    const install = b.addInstallArtifact(exe, .{});
    b.getInstallStep().dependOn(&install.step);

    const wasm = b.step("wasm", "Build ghostty-vt wasm wrapper");
    wasm.dependOn(&install.step);
}

fn ghosttyVtModule(
    b: *std.Build,
    target: std.Build.ResolvedTarget,
    optimize: std.builtin.OptimizeMode,
    terminal_options: *std.Build.Step.Options,
) *std.Build.Module {
    const module = b.createModule(.{
        .root_source_file = b.path("../../vendor/libghostty/src/lib_vt.zig"),
        .target = target,
        .optimize = optimize,
    });
    module.addOptions("terminal_options", terminal_options);
    return module;
}
