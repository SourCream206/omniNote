use std::env;
use std::fs;

fn virtual_machine_label(value: &str) -> bool {
    let value = value.to_ascii_lowercase();
    ["virtualbox", "vmware", "qemu", "kvm", "bochs", "parallels", "virtual machine"]
        .iter()
        .any(|name| value.contains(name))
}

fn running_in_virtual_machine() -> bool {
    ["/sys/class/dmi/id/product_name", "/sys/class/dmi/id/sys_vendor"]
        .iter()
        .filter_map(|path| fs::read_to_string(path).ok())
        .any(|value| virtual_machine_label(&value))
}

pub fn configure() {
    if env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_some() { return; }
    let compatibility = match env::var("OMNINOTE_GRAPHICS_COMPAT").as_deref() {
        Ok("1") => true,
        Ok("0") => false,
        _ => running_in_virtual_machine(),
    };
    if compatibility {
        // Set this before WebKitGTK starts; normal Linux GPU paths keep acceleration.
        env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }
}

#[cfg(test)]
mod tests {
    use super::virtual_machine_label;

    #[test]
    fn detects_common_vm_labels_without_matching_real_hardware() {
        for label in ["VirtualBox", "VMware Virtual Platform", "QEMU Standard PC", "KVM", "Microsoft Corporation Virtual Machine"] {
            assert!(virtual_machine_label(label), "{label}");
        }
        for label in ["HP ENVY", "Dell Inc.", "Microsoft Corporation Surface Pro"] {
            assert!(!virtual_machine_label(label), "{label}");
        }
    }
}
